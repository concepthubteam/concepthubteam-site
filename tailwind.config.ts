import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Inter", "Segoe UI", "Roboto", "Helvetica", "Arial", "Apple Color Emoji", "Segoe UI Emoji"],
        display: ["ui-sans-serif", "system-ui", "Space Grotesk", "Inter", "Segoe UI", "Roboto", "Helvetica", "Arial"]
      },
      colors: {
        ink: {
          950: "#07070A",
          900: "#0B0C10",
          850: "#0F1117",
          800: "#121521",
          700: "#1A2030"
        },
        accent: {
          500: "#E11D48"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(0,0,0,0.35)"
      }
    }
  },
  plugins: []
} satisfies Config;
