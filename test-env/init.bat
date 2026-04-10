@echo off
echo.
echo === Cockpit Agent - Environnement de test Sage ===
echo.

echo [1/3] Demarrage du conteneur SQL Server...
docker-compose up -d
if errorlevel 1 (
    echo ERREUR : docker-compose up a echoue. Docker Desktop est-il lance ?
    pause
    exit /b 1
)

echo.
echo [2/3] Attente du demarrage SQL Server (45 secondes)...
timeout /t 45 /nobreak

echo.
echo [3/3] Chargement du schema et des donnees de test...
docker-compose exec -T sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "CockpitTest#2024" -i /seed/seed_test.sql

if errorlevel 1 (
    echo.
    echo ERREUR lors du seed. Relancer dans 30s si SQL Server n'etait pas encore pret :
    echo   docker-compose exec -T sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "CockpitTest#2024" -i /seed/seed_test.sql
) else (
    echo.
    echo ==============================================
    echo   Base SAGE_TEST prete !
    echo.
    echo   Host     : localhost
    echo   Port     : 1434
    echo   Database : SAGE_TEST
    echo   User     : sa
    echo   Password : CockpitTest#2024
    echo ==============================================
)

echo.
pause
