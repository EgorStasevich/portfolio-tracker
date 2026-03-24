# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Notion CMS Sync

This project can load project cards/cases and experience entries from Notion.

1. Create `.env.local` in the project root:

```bash
NOTION_TOKEN=ntn_xxx
NOTION_DATABASE_ID=32c3192fb76780e297b7cabe14b20b73
NOTION_EXPERIENCE_DATABASE_ID=32d3192fb7678009b51dcbcbea1bb42c
```

2. Sync data from Notion:

```bash
npm run sync:notion
npm run sync:notion:experience
```

3. Start the app:

```bash
npm run dev
```

### Cases database fields

- `Name` (Title)
- `Slug` (Rich text, unique)
- `Published` (Checkbox)
- `Order` (Number)
- `Card Description` (Rich text)
- `Card Image` (URL)
- `Tags` (Multi-select)
- `Project Summary` (Rich text)
- `Role` (Rich text)
- `Problem` (Rich text)
- `Result 1..4` (Rich text)
- `Intro Heading`, `Intro Body` (Rich text)
- `Middle Heading`, `Middle Body` (Rich text)
- `Final Heading`, `Final Body` (Rich text)
- `Hero Image` (URL)
- `Image 1..6` (URL)
- `Carousel 1 Image 1..3` (URL)
- `Carousel 2 Image 1..3` (URL)

`/projects` and `/projects/:slug` keep the original static layout, while text and image values are injected from Notion.

### Experience database fields

- `Name` (Title)
- `Published` (Checkbox, optional)
- `Position` or `Order` (Number, optional)
- `Role` (Rich text)
- `Timeline` (Rich text or Date)
- `Paragraph` (Rich text)
- `Company` (Rich text)
- `Location` (Rich text)

`/experience` keeps the original static layout, while card content values are injected from `public/data/experience.json`.
