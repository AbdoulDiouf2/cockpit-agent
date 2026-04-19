; Cockpit Agent — NSIS custom header
; Force l'élévation UAC dès le lancement de l'installeur.
; Requis pour que l'Electron puisse enregistrer le service Windows (SCM).
!macro customHeader
  RequestExecutionLevel admin
!macroend
