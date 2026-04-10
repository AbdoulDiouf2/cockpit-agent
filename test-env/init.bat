@echo off
REM =============================================================================
REM init.bat — Lance le conteneur et initialise la base SAGE_TEST (Windows)
REM Usage : double-cliquer ou lancer depuis un terminal
REM =============================================================================

echo >>> Démarrage du conteneur SQL Server...
docker-compose up -d

echo >>> Attente que SQL Server soit prêt (30-45 secondes)...
:wait_loop
timeout /t 5 /nobreak > nul
docker-compose exec -T sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "CockpitTest#2024" -Q "SELECT 1" > nul 2>&1
if errorlevel 1 (
    echo   ... encore en cours de démarrage
    goto wait_loop
)
echo >>> SQL Server prêt !

echo >>> Exécution du seed...
docker-compose exec -T sqlserver ^
    /opt/mssql-tools/bin/sqlcmd ^
    -S localhost -U sa -P "CockpitTest#2024" ^
    -i /seed/seed_test.sql ^
    -r 1

echo.
echo ==============================================
echo   Base SAGE_TEST prête !
echo   Host     : localhost
echo   Port     : 1434
echo   Database : SAGE_TEST
echo   User     : sa
echo   Password : CockpitTest#2024
echo ==============================================
echo.
echo Configurer l'agent avec ces paramètres.
pause
