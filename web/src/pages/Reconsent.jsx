import { useState } from 'react';
import { api } from '../api.js';
import { BrandHeader, BusyOverlay, Field, Notice, PageTitle } from '../ui.jsx';

function readToken() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('token')) return params.get('token');
  const hashQuery = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(hashQuery).get('token') || '';
}

export default function Reconsent() {
  const [token] = useState(readToken);
  const [version, setVersion] = useState('v1.0');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!token) return setMessage({ type: 'error', text: '동의 링크에 회원 토큰이 없습니다. 전달받은 링크를 다시 확인해 주세요.' });
    if (!agreed) return setMessage({ type: 'warning', text: '개인정보 수집·이용 내용을 확인하고 동의해 주세요.' });
    setBusy(true); setMessage(null);
    try {
      const result = await api.reconsentByToken(token, version.trim() || 'v1.0');
      setDone(true);
      setMessage({ type: 'success', text: result || '동의 내용이 반영되었습니다.' });
    } catch (error) { setMessage({ type: 'error', text: error?.message || String(error) }); }
    finally { setBusy(false); }
  }

  return (
    <main className="shell shell-narrow">
      <BrandHeader title="개인정보 동의" subtitle="Consent renewal" actions={<a className="header-link" href="#/">회원관리</a>} />
      <PageTitle eyebrow="Consent renewal" title="개인정보 재동의" description="안내받은 전용 링크에서 동의 내용을 갱신할 수 있습니다." />
      {message && <Notice type={message.type}>{message.text}</Notice>}
      {done ? (
        <section className="success-panel"><div className="success-mark">✓</div><h2>동의가 완료되었습니다</h2><p>창을 닫으셔도 됩니다. 회원 정보에 최신 동의 시각이 기록되었습니다.</p></section>
      ) : (
        <form className="card" onSubmit={submit}>
          <div className="consent-copy" style={{ height: 260 }}>
            <h3>개인정보 수집·이용 목적</h3><p>본인 확인과 회원 관리, 회비·증명서 관리, 행사와 교육 안내 및 공지 발송에 이용합니다.</p>
            <h3>수집 항목</h3><p>필수 항목은 성명, 성별, 생년월일, 전화번호, 주소이며 선택 항목은 사진, 이메일, 가족관계와 직업 정보 등입니다.</p>
            <h3>보유 기간 및 동의 거부</h3><p>회원 탈퇴 또는 목적 달성 시까지 보유합니다. 동의를 거부할 수 있으나 필수 항목 미동의 시 회원 서비스가 제한될 수 있습니다.</p>
          </div>
          <label className="check-row"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span><b>위 개인정보 수집·이용 내용에 동의합니다.</b></span></label>
          <Field label="동의 버전"><input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.0" /></Field>
          {!token && <Notice type="error">유효한 토큰이 없습니다. 원래 전달받은 링크로 다시 접속해 주세요.</Notice>}
          <button className="button primary block" style={{ marginTop: 18 }} disabled={!token || !agreed}>동의하고 제출</button>
        </form>
      )}
      <BusyOverlay show={busy} label="동의 내용을 반영하고 있습니다" />
    </main>
  );
}
