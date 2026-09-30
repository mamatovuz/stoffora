import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./components/ui";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
