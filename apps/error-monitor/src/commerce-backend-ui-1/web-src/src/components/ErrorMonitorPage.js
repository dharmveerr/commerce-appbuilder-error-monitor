import React, { useCallback, useEffect, useState } from 'react';
import { Heading, Flex, View, Picker, Item, TextField, Button, ProgressCircle, StatusLight, Text, Well, Divider, DialogContainer, Dialog, Content, Link } from '@adobe/react-spectrum';
import actions from '../config.json';
import { buildQuery, parseDetailResponse, parseListResponse, SEVERITIES } from '../lib/viewModel';

const VARIANT = { debug: 'neutral', info: 'info', warning: 'notice', error: 'negative', critical: 'negative' };

async function call(url, ims) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${ims.token}`, 'x-gw-ims-org-id': ims.org } });
  let json = null;
  try { json = await res.json(); } catch (e) { /* invalid JSON is handled by the view-model */ }
  return { status: res.status, json };
}

export default function ErrorMonitorPage({ ims }) {
  const [filters, setFilters] = useState({ source: 'state', severity: '', app: '', limit: '25', date: new Date().toISOString().slice(0, 10) });
  const [list, setList] = useState({ state: 'loading', rows: [] });
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    if (ims === undefined) { setList({ state: 'loading', rows: [] }); return; } // still connecting to the Admin
    if (!ims) { setList({ state: 'error', rows: [], message: 'This page must be opened from the Commerce Admin menu (no Adobe sign-in was received).' }); return; }
    setList({ state: 'loading', rows: [] });
    try {
      const r = await call(`${actions['error-monitor/list-errors']}?${buildQuery(filters)}`, ims);
      setList(parseListResponse(r.status, r.json));
    } catch (e) {
      setList({ state: 'error', rows: [], message: 'Could not reach the Error Monitor service.' });
    }
  }, [filters, ims]);

  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    setDetail({ state: 'loading' });
    try {
      const r = await call(`${actions['error-monitor/get-error']}?id=${encodeURIComponent(id)}`, ims);
      setDetail(parseDetailResponse(r.status, r.json));
    } catch (e) {
      setDetail({ state: 'error', message: 'Could not reach the Error Monitor service.' });
    }
  };

  return (
    <View padding="size-300">
      <Heading level={2}>Error Monitor{list.instance ? ` — ${list.instance}` : ''}</Heading>
      <Flex gap="size-200" alignItems="end" wrap marginBottom="size-200">
        <Picker label="Store" selectedKey={filters.source} onSelectionChange={(k) => setFilters({ ...filters, source: k })}>
          <Item key="state">Recent (State)</Item>
          <Item key="archive">Archive (Files)</Item>
        </Picker>
        <Picker label="Severity" selectedKey={filters.severity || 'all'} onSelectionChange={(k) => setFilters({ ...filters, severity: k === 'all' ? '' : k })}>
          {['all', ...SEVERITIES].map((s) => <Item key={s}>{s}</Item>)}
        </Picker>
        <TextField label="Application" value={filters.app} onChange={(v) => setFilters({ ...filters, app: v })} />
        {filters.source === 'archive' && <TextField label="Date (YYYY-MM-DD)" value={filters.date} onChange={(v) => setFilters({ ...filters, date: v })} />}
        <Button variant="secondary" onPress={load}>Refresh</Button>
      </Flex>

      {list.state === 'loading' && <ProgressCircle aria-label="Loading error records" isIndeterminate />}
      {['empty', 'invalid', 'error'].includes(list.state) && <Well><Text>{list.message}</Text></Well>}
      {list.state === 'ok' && (
        <View>
          {list.skipped > 0 && <Text>{list.skipped} record(s) were hidden because they could not be displayed.</Text>}
          {list.truncated && <Text> Results were truncated; narrow the filters.</Text>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Time</th><th align="left">Severity</th><th align="left">Application</th><th align="left">Error</th><th align="left">Message</th></tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.when}</td>
                  <td><StatusLight variant={VARIANT[r.severity]}>{r.severity}</StatusLight></td>
                  <td>{r.app}{r.action ? ` / ${r.action}` : ''}</td>
                  <td>{r.name}{r.code ? ` (${r.code})` : ''}</td>
                  <td><Link onPress={() => open(r.id)}>{r.message || '(no message)'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </View>
      )}

      <DialogContainer onDismiss={() => setDetail(null)}>
        {detail && (
          <Dialog isDismissable>
            <Heading>Error details</Heading>
            <Divider />
            <Content>
              {detail.state === 'loading' && <ProgressCircle aria-label="Loading" isIndeterminate />}
              {['invalid', 'error'].includes(detail.state) && <Text>{detail.message}</Text>}
              {detail.state === 'ok' && (
                <Flex direction="column" gap="size-100">
                  <Text>ID: {detail.detail.id} · {detail.storedIn}</Text>
                  <Text>{detail.detail.when} · {detail.detail.severity} · instance {detail.detail.instance}</Text>
                  <Text>{detail.detail.app}{detail.detail.action ? ` / ${detail.detail.action}` : ''} {detail.detail.version} {detail.detail.environment}</Text>
                  <Text>{detail.detail.name}{detail.detail.code ? ` (${detail.detail.code})` : ''}: {detail.detail.message}</Text>
                  {detail.detail.http && <Text>HTTP: {detail.detail.http}</Text>}
                  {detail.detail.requestId && <Text>Request: {detail.detail.requestId}</Text>}
                  <Text>Fingerprint: {detail.detail.fingerprint} · {detail.detail.redactions} value(s) redacted</Text>
                  {detail.detail.tags.map(([k, v]) => <Text key={k}>{k}: {v}</Text>)}
                  {detail.detail.stack && <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{detail.detail.stack}</pre>}
                </Flex>
              )}
            </Content>
          </Dialog>
        )}
      </DialogContainer>
    </View>
  );
}
