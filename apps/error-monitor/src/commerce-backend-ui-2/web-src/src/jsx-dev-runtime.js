// Parcel (via aio) compiles JSX in development mode, but the Commerce build hook ships production React, which has no jsxDEV.
export { Fragment, jsx as jsxDEV } from 'react/jsx-runtime';
