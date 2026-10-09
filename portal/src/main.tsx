import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const root = document.getElementById("root");
if (!root) throw new Error("Portal shell unavailable");
createRoot(root).render(<React.StrictMode><main><h1>Monotorr ConnectWise</h1><p>Your ConnectWise data. Your AI.</p><p role="status">Customer setup is not available yet.</p><p>This deployment is a delivery foundation. No signup, billing, or connection configuration is enabled.</p></main></React.StrictMode>);
