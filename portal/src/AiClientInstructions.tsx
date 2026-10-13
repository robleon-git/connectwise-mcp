import React, { useRef, useState } from "react";
export const MCP_ADDRESS = "https://api.monotorr.com/mcp";
export async function copyMcpAddress(clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<boolean> {
  try { if (!clipboard) return false; await clipboard.writeText(MCP_ADDRESS); return true; } catch { return false; }
}
export function AiClientInstructions() {
  const [copyStatus, setCopyStatus] = useState("");
  const [copying, setCopying] = useState(false);
  const inFlight = useRef(false);
  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true; setCopying(true);
    const copied = await copyMcpAddress(navigator.clipboard);
    setCopyStatus(copied ? "Address copied." : "Couldn’t copy automatically. Select and copy the address above.");
    inFlight.current = false; setCopying(false);
  }
  return <div className="ai-instructions">
    <h3>ChatGPT</h3><p>Add Monotorr with this server address:</p>
    <code className="endpoint">{MCP_ADDRESS}</code>
    <div className="actions"><button type="button" className="secondary" disabled={copying} onClick={() => { void copy(); }}>Copy address</button>
      <a className="button" href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">Open ChatGPT</a></div>
    <p role="status" className="helper">{copyStatus}</p>
    <ol><li>Sign in to the ChatGPT account you want to use.</li><li>Open ChatGPT Plugins.</li>
      <li>Choose the plus button, then Add custom MCP server.</li><li>Name it Monotorr, enter <code>{MCP_ADDRESS}</code>, and choose OAuth authentication.</li>
      <li>Use the same email-code sign-in you connected in Monotorr. Keep the read-only permission selected.</li>
      <li>Create and install the plugin. Return to ChatGPT, select Monotorr, and start asking questions.</li></ol>
    <p className="helper">If ChatGPT asks you to sign in again, use that same email-code sign-in. Reconnect in ChatGPT if needed; your Monotorr setup stays saved.</p>
    <div className="other-clients"><details><summary>Claude</summary><p>Open Claude’s Connectors settings and add a custom connector with <code>{MCP_ADDRESS}</code>. Connect with OAuth and the same email-code sign-in you connected in Monotorr. Availability depends on your plan and workspace.</p></details>
      <details><summary>Copilot Studio</summary><p>In your agent’s Tools, add an MCP server with <code>{MCP_ADDRESS}</code>. Choose OAuth 2.0 with dynamic discovery, then create the connection using the same email-code sign-in. These instructions apply to Copilot Studio.</p></details>
      <details><summary>Other MCP-compatible clients</summary><p>Use <code>{MCP_ADDRESS}</code> as the remote server address. Choose OAuth authentication and use the same email-code sign-in you connected in Monotorr. Your client must support remote MCP and this OAuth flow.</p></details></div>
  </div>;
}
