; Cockpit Agent — NSIS custom header
; Force l'élévation UAC dès le lancement de l'installeur.
; Requis pour que l'Electron puisse enregistrer le service Windows (SCM).
!macro customHeader
  RequestExecutionLevel admin
!macroend

; Arrête le service et tue le processus avant que NSIS vérifie si l'app tourne.
; Sans ça, l'installateur bloque sur "Cockpit Agent ne peut pas être fermé".
!macro customInit
  nsExec::ExecToStack 'sc stop "CockpitAgent"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM "cockpit-agent-service.exe"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM "Cockpit Agent.exe"'
  Pop $0
  Pop $1
  Sleep 2000
!macroend
