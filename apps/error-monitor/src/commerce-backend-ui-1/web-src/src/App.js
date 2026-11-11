import React from 'react';
import { Provider, defaultTheme } from '@adobe/react-spectrum';
import { Route, Routes } from 'react-router-dom';
import ExtensionRegistration from './components/ExtensionRegistration';

export default function App() {
  return (
    <Provider theme={defaultTheme} colorScheme="light">
      <Routes>
        {/* Every route goes through ExtensionRegistration, as the Admin UI SDK requires. */}
        <Route path="*" element={<ExtensionRegistration />} />
      </Routes>
    </Provider>
  );
}
