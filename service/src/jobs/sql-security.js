'use strict';

/**
 * Validation et sanitisation des requêtes SQL.
 * Parité fonctionnelle avec l'ancien agent Python (security.py).
 *
 * Mécanismes :
 *  1. SELECT uniquement (DML whitelist)
 *  2. Mots-clés interdits (DDL, DML write, procédures système)
 *  3. Commentaires SQL interdits (--, /‍* *‍/)
 *  4. Multi-statements interdits (;)
 *  5. Whitelist de tables (depuis config.json allowed_tables)
 *  6. Injection automatique TOP {max_rows} si absent / réduction si dépassé
 */

const logger = require('../utils/logger');

class SQLSecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SQLSecurityError';
  }
}

// Mots-clés interdits (write + système)
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE',
  'MERGE', 'BULK', 'OPENROWSET', 'OPENDATASOURCE', 'XP_', 'SP_',
];

/**
 * Extrait les noms de tables d'un SELECT (FROM + JOINs).
 * Simple tokenizer — pas d'AST complet, mais couvre 99% des cas.
 */
function _extractTables(sql) {
  const tables = new Set();
  // Normalise : supprime strings entre quotes pour éviter les faux positifs
  const cleaned = sql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');

  // Regex : FROM <table> et JOIN <table>
  const re = /(?:FROM|JOIN)\s+(?:\[?(\w+)\]?\.)?(?:\[?dbo\]?\.)?(?:\[?(\w+)\]?)/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const table = (m[2] || m[1] || '').toUpperCase().replace(/[\[\]]/g, '');
    if (table) tables.add(table);
  }
  return tables;
}

/**
 * Valide et sanitise une requête SQL.
 *
 * @param {string} sql
 * @param {Object} opts
 * @param {string[]} opts.allowedTables  — liste des tables autorisées (vide = tout autorisé)
 * @param {number}   opts.maxRows        — plafond TOP (défaut 1000)
 * @returns {string} SQL sanitisé (TOP injecté)
 * @throws {SQLSecurityError}
 */
function validate(sql, { allowedTables = [], maxRows = 1000 } = {}) {
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    throw new SQLSecurityError('Requête SQL vide ou invalide');
  }

  const trimmed = sql.trim();

  // 1. Multi-statements — point-virgule interdit (sauf en fin de chaîne)
  const withoutTrailingSemi = trimmed.replace(/;\s*$/, '');
  if (withoutTrailingSemi.includes(';')) {
    throw new SQLSecurityError('Plusieurs instructions SQL ne sont pas autorisées');
  }

  // 2. Commentaires interdits
  if (/--/.test(trimmed) || /\/\*/.test(trimmed) || /\*\//.test(trimmed)) {
    throw new SQLSecurityError('Les commentaires SQL ne sont pas autorisés');
  }

  // 3. SELECT uniquement
  if (!/^\s*SELECT\b/i.test(trimmed)) {
    throw new SQLSecurityError('Seules les requêtes SELECT sont autorisées');
  }

  // 4. Mots-clés interdits
  const upper = trimmed.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    // Cherche en tant que mot entier (sauf XP_ et SP_ qui sont préfixes)
    const pattern = kw.endsWith('_')
      ? new RegExp(kw.replace('_', '\\_'), 'i')
      : new RegExp(`\\b${kw}\\b`, 'i');
    if (pattern.test(upper)) {
      throw new SQLSecurityError(`Instruction interdite détectée : ${kw}`);
    }
  }

  // 5. Whitelist des tables
  // Les vues Cockpit (VW_*) et tables de config (PLATEFORME_*) sont toujours autorisées.
  if (allowedTables.length > 0) {
    const allowed = new Set(allowedTables.map(t => t.toUpperCase()));
    const used    = _extractTables(trimmed);
    const blocked = [...used].filter(t =>
      !allowed.has(t) &&
      !t.startsWith('VW_') &&
      !t.startsWith('PLATEFORME_')
    );
    if (blocked.length > 0) {
      logger.warn(`[sql-security] Tables non autorisées : ${blocked.join(', ')}`);
      throw new SQLSecurityError(`Tables non autorisées : ${blocked.join(', ')}`);
    }
  }

  // 6. TOP automatique
  const sanitized = _ensureTop(trimmed, maxRows);

  return sanitized;
}

/**
 * Injecte ou réduit la clause TOP.
 * - Si TOP absent → INSERT après SELECT [DISTINCT]
 * - Si TOP présent et > maxRows → remplace par maxRows
 * - Si TOP présent et <= maxRows → inchangé
 */
function _ensureTop(sql, maxRows) {
  const topMatch = /\bTOP\s+(\d+)\b/i.exec(sql);

  if (topMatch) {
    const existing = parseInt(topMatch[1], 10);
    if (existing > maxRows) {
      return sql.replace(/\bTOP\s+\d+\b/i, `TOP ${maxRows}`);
    }
    return sql; // TOP déjà correct
  }

  // Pas de TOP — l'injecter après SELECT [DISTINCT]
  return sql.replace(/^(\s*SELECT\s+(?:DISTINCT\s+)?)/i, `$1TOP ${maxRows} `);
}

module.exports = { validate, SQLSecurityError };
