#!/bin/bash
# =============================================================================
# init.sh — Lance le conteneur et initialise la base SAGE_TEST
# Usage : bash init.sh
# =============================================================================

set -e

echo ">>> Démarrage du conteneur SQL Server..."
docker-compose up -d

echo ">>> Attente que SQL Server soit prêt (peut prendre 30-45 secondes)..."
until docker-compose exec -T sqlserver \
    /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "CockpitTest#2024" \
    -Q "SELECT 1" > /dev/null 2>&1; do
  printf "."
  sleep 3
done
echo ""
echo ">>> SQL Server prêt !"

echo ">>> Exécution du seed (schéma + données)..."
docker-compose exec -T sqlserver \
    /opt/mssql-tools/bin/sqlcmd \
    -S localhost -U sa -P "CockpitTest#2024" \
    -i /seed/seed_test.sql \
    -r 1

echo ""
echo "=============================================="
echo "  Base SAGE_TEST prête !"
echo "  Host     : localhost"
echo "  Port     : 1434"
echo "  Database : SAGE_TEST"
echo "  User     : sa"
echo "  Password : CockpitTest#2024"
echo "=============================================="
echo ""
echo "Configurer l'agent :"
echo "  server   = localhost"
echo "  port     = 1434"
echo "  database = SAGE_TEST"
echo "  user     = sa"
echo "  password = CockpitTest#2024"
