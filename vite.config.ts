import { defineConfig } from "vite";
import { ticketCardInline } from "./scripts/build/ticket-card-inline.mjs";

// Preserve the MCP Apps self-contained HTML contract and existing Vite output.
export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [ticketCardInline()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    assetsInlineLimit: () => true,
    assetsDir: "",
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100000000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
