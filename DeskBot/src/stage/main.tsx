import React from 'react'
import { createRoot } from 'react-dom/client'
import StageApp from './StageApp'
import './stage.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StageApp />
  </React.StrictMode>,
)
