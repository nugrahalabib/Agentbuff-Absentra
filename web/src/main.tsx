import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/geist/wght.css'
import App from './App'
import './index.css'
import { bacaPilihanTema, pantauTemaSistem, terapkanTema } from './lib/tema'

terapkanTema(bacaPilihanTema())
pantauTemaSistem()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
