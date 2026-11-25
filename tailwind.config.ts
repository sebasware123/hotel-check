import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1e293b",
        muted: "#64748b",
        line: "#e8e7e4",
        canvas: "#faf9f7",
        coral: "#e76f51",
        forest: "#1d6b57",
      },
      boxShadow: {
        soft: "0 18px 60px rgba(30, 41, 59, .10)",
      },
    },
  },
  plugins: [],
};

export default config;
