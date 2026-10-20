import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App"
import "@material-symbols/font-400/outlined.css"
import "./theme.css"

const root = document.getElementById("root")
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
