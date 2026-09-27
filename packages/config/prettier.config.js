/**
 * Shared Prettier options. Only settings that differ from Prettier 3 defaults are listed.
 * Everything else (semi: true, trailingComma: "all", tabWidth: 2, ...) is the default.
 */
export default {
  printWidth: 100, // default 80 is tight for TypeScript generics and JSX props
  singleQuote: true, // matches the common TS/React ecosystem style
};
