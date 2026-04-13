import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './Contexts/AuthContext'
import { AbsenceProvider } from './Contexts/AbsenceContext'
import { NotificationProvider } from './Contexts/NotificationContext'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AbsenceProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </AbsenceProvider>
    </AuthProvider>
  </StrictMode>,
)
