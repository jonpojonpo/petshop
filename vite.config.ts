import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ["**/.petshop/**"] },
    fs: {
      deny: ["**/.petshop/**", "**/.git/**", "**/.env*", "**/*.{crt,pem}"],
    },
  },
  build: { outDir: "dist" },
});
