import { Fragment, useEffect, useRef, useState } from 'react';
import { useIms } from '@adobe/aio-commerce-lib-admin-ui/web';
import { Button, Picker, PickerItem, ProgressCircle, StatusLight, TextField } from '@react-spectrum/s2';

import { useConfig } from '#web/hooks/use-config.js';
import {
  SEVERITIES, STATUS_VARIANT, buildQuery, parseAppFilter, parseDetailResponse, parseListResponse, severityCounts,
} from '#web/lib/viewModel.js';

// All record text reaches the DOM as React text nodes (auto-escaped). There is no HTML sink in this file.

const today = () => new Date().toISOString().slice(0, 10);

/** Calls one of this app's IMS-protected actions as the signed-in admin. */
async function callAction(url, ims) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${ims.imsToken}`, 'x-gw-ims-org-id': ims.imsOrgId },
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* the view-model reports invalid bodies */ }
  return { status: res.status, json };
}

const css = {
  page: { padding: '16px 24px', maxWidth: 1200 },
  intro: { margin: '0 0 16px', maxWidth: '72ch' },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'end', marginBottom: 16 },
  strip: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 16px', padding: 0, listStyle: 'none' },
  chip: (active) => ({
    display: 'flex', alignItems: 'center', gap: 4, padding: '2px 10px', cursor: 'pointer', borderRadius: 16, font: 'inherit',
    border: active ? '2px solid currentColor' : '1px solid rgba(128,128,128,.5)', background: 'transparent', color: 'inherit',
  }),
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px', borderBottom: '2px solid rgba(128,128,128,.4)', whiteSpace: 'nowrap' },
  td: { padding: '8px', borderBottom: '1px solid rgba(128,128,128,.25)', verticalAlign: 'top' },
  rowButton: { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', textDecoration: 'underline' },
  notice: { padding: 16, border: '1px solid rgba(128,128,128,.4)', borderRadius: 8, maxWidth: '72ch' },
  detail: { marginTop: 24, padding: 16, border: '1px solid rgba(128,128,128,.4)', borderRadius: 8 },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: '12px 0' },
  pre: { whiteSpace: 'pre-wrap', overflowX: 'auto', margin: 0, padding: 12, background: 'rgba(128,128,128,.08)', borderRadius: 4 },
};

function Notice({ children }) {
  return <p role="status" style={css.notice}>{children}</p>;
}

function SeverityStrip({ rows, active, onToggle }) {
  const counts = severityCounts(rows);
  return (
    <ul style={css.strip} aria-label="Errors shown by severity. Select one to filter.">
      {SEVERITIES.map((s) => (
        <li key={s}>
          <button type="button" style={css.chip(active === s)} aria-pressed={active === s} onClick={() => onToggle(s)}>
            <StatusLight variant={STATUS_VARIANT[s]}>{`${s} ${counts[s]}`}</StatusLight>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Detail({ state, onClose }) {
  if (!state) return null;
  return (
    <section style={css.detail} aria-label="Error details">
      {state.state === 'loading' && <ProgressCircle aria-label="Loading error details" isIndeterminate />}
      {['invalid', 'error'].includes(state.state) && <Notice>{state.message}</Notice>}
      {state.state === 'ok' && (
        <>
          <h2 style={{ margin: 0 }}>{state.detail.name}{state.detail.code ? ` (${state.detail.code})` : ''}</h2>
          <p style={{ maxWidth: '72ch' }}>{state.detail.message}</p>
          <dl style={css.dl}>
            <dt>Severity</dt><dd><StatusLight variant={STATUS_VARIANT[state.detail.severity]}>{state.detail.severity}</StatusLight></dd>
            <dt>When</dt><dd>{state.detail.when}</dd>
            <dt>Application</dt><dd>{state.detail.app}{state.detail.action ? ` / ${state.detail.action}` : ''}</dd>
            {state.detail.version && <><dt>Version</dt><dd>{state.detail.version}</dd></>}
            {state.detail.environment && <><dt>Environment</dt><dd>{state.detail.environment}</dd></>}
            {state.detail.http && <><dt>Request</dt><dd>{state.detail.http}</dd></>}
            {state.detail.requestId && <><dt>Request ID</dt><dd>{state.detail.requestId}</dd></>}
            <dt>Record ID</dt><dd>{state.detail.id}</dd>
            <dt>Stored in</dt><dd>{state.storedIn}</dd>
            <dt>Fingerprint</dt><dd>{state.detail.fingerprint}</dd>
            <dt>Hidden values</dt><dd>{`${state.detail.redactions} sensitive value(s) were masked before saving`}</dd>
            {state.detail.tags.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
          </dl>
          {state.detail.stack && <pre style={css.pre}>{state.detail.stack}</pre>}
        </>
      )}
      <div style={{ marginTop: 16 }}><Button variant="secondary" onPress={onClose}>Close details</Button></div>
    </section>
  );
}

export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const { getActionUrl } = useConfig();
  const imsToken = ims ? ims.imsToken : undefined;
  const imsOrgId = ims ? ims.imsOrgId : undefined;
  const ready = Boolean(imsToken && imsOrgId);

  // `query` drives requests; text fields edit `draft` and are applied with Refresh, so typing does not refetch.
  const [query, setQuery] = useState({ source: 'state', app: '', action: '', date: today(), limit: '50' });
  const [draft, setDraft] = useState({ app: '', date: today() });
  const [severity, setSeverity] = useState('');
  const [list, setList] = useState({ state: 'loading', rows: [] });
  const [detail, setDetail] = useState(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!ready) return undefined;
    const seq = ++requestSeq.current;
    setList({ state: 'loading', rows: [] });
    callAction(`${getActionUrl('error-monitor/list-errors')}?${buildQuery(query)}`, { imsToken, imsOrgId })
      .then((r) => { if (seq === requestSeq.current) setList(parseListResponse(r.status, r.json)); })
      .catch(() => {
        if (seq === requestSeq.current) setList({ state: 'error', rows: [], message: "The Error Monitor can't be reached. Check your connection and select Refresh." });
      });
    return undefined;
  }, [ready, imsToken, imsOrgId, getActionUrl, query]);

  // Always a new object, so Refresh reloads even when the filters are unchanged.
  const refresh = () => setQuery((q) => ({ ...q, ...parseAppFilter(draft.app), date: draft.date.trim() }));

  const open = async (id) => {
    setDetail({ state: 'loading' });
    try {
      const r = await callAction(`${getActionUrl('error-monitor/get-error')}?id=${encodeURIComponent(id)}`, { imsToken, imsOrgId });
      setDetail(parseDetailResponse(r.status, r.json));
    } catch (e) {
      setDetail({ state: 'error', message: "The Error Monitor can't be reached. Check your connection and try again." });
    }
  };

  if (imsError) {
    return <main style={css.page}><Notice>Open this page from the Commerce Admin menu (System, then Error Monitor). It needs your Admin sign-in to load error records.</Notice></main>;
  }

  const visible = list.state === 'ok'
    ? list.rows.filter((r) => (!severity || r.severity === severity) && (!query.action || r.action === query.action))
    : [];

  return (
    <main style={css.page}>
      <p style={css.intro}>
        {list.instance ? `Errors reported by App Builder apps for ${list.instance}.` : 'Errors reported by App Builder apps for this Commerce instance.'}
        {' '}Sensitive values are masked before anything is saved.
      </p>

      <div style={css.filters}>
        <Picker label="Store" value={query.source} onChange={(k) => { if (k) setQuery((q) => ({ ...q, source: String(k), date: draft.date.trim() })); }}>
          <PickerItem id="state">Recent</PickerItem>
          <PickerItem id="archive">Archive (by day)</PickerItem>
        </Picker>
        {query.source === 'archive' && (
          <TextField label="Day (YYYY-MM-DD)" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} />
        )}
        <TextField label="Application" value={draft.app} onChange={(v) => setDraft((d) => ({ ...d, app: v }))} />
        <Button variant="secondary" onPress={refresh}>Refresh</Button>
      </div>

      {list.state === 'ok' && (
        <SeverityStrip rows={list.rows} active={severity} onToggle={(s) => setSeverity((cur) => (cur === s ? '' : s))} />
      )}

      {(!ready || list.state === 'loading') && <ProgressCircle aria-label="Loading error records" isIndeterminate />}
      {ready && ['empty', 'invalid', 'error'].includes(list.state) && <Notice>{list.message}</Notice>}

      {ready && list.state === 'ok' && (
        <>
          {list.skipped > 0 && <Notice>{`${list.skipped} record(s) are hidden because they are in a format this dashboard can't show.`}</Notice>}
          {list.truncated && <Notice>Only the newest records are shown. Narrow the filters to see others.</Notice>}
          <table style={css.table}>
            <caption style={{ textAlign: 'left', paddingBottom: 8 }}>{`${visible.length} of ${list.rows.length} error(s), newest first. Select a message to see details.`}</caption>
            <thead>
              <tr><th style={css.th}>When</th><th style={css.th}>Severity</th><th style={css.th}>Application</th><th style={css.th}>Error</th><th style={css.th}>Message</th></tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{r.when}</td>
                  <td style={css.td}><StatusLight variant={STATUS_VARIANT[r.severity]}>{r.severity}</StatusLight></td>
                  <td style={css.td}>{r.app}{r.action ? ` / ${r.action}` : ''}</td>
                  <td style={css.td}>{r.name}{r.code ? ` (${r.code})` : ''}</td>
                  <td style={css.td}><button type="button" style={css.rowButton} onClick={() => open(r.id)}>{r.message || '(no message)'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Detail state={detail} onClose={() => setDetail(null)} />
    </main>
  );
}
