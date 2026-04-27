import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d9ecff",
          200: "#bcdfff",
          300: "#8ecbff",
          400: "#58aeff",
          500: "#3491ff",
          600: "#1c73f5",
          700: "#155de1",
          800: "#174cb6",
          900: "#19438f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
