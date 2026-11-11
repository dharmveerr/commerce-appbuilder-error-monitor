import React, { useEffect, useState } from 'react';
import { register, attach } from '@adobe/uix-guest';
import { extensionId } from '../constants';
import { readIms } from '../lib/ims';
import ErrorMonitorPage from './ErrorMonitorPage';

/**
 * Admin UI SDK entry point. The app route renders this component (App Review Checklist: routing must go to
 * ExtensionRegistration, which then renders the main page). It registers the guest, then attaches to read the
 * IMS token + org from the shared context and hands them to the page. Works the same on ACCS (SaaS) and PaaS.
 */
export default function ExtensionRegistration() {
  const [ims, setIms] = useState(undefined); // undefined = connecting, null = unavailable

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await register({ id: extensionId, methods: {} });
      } catch (e) {
        // Already registered in this frame, or not running inside the Admin; attach below decides.
      }
      try {
        const connection = await attach({ id: extensionId });
        if (!cancelled) setIms(readIms(connection && connection.sharedContext));
      } catch (e) {
        if (!cancelled) setIms(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <ErrorMonitorPage ims={ims} />;
}
