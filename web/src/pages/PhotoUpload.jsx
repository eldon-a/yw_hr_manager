import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { driveThumbnail, formatBytes, getImageSize, isAllowedImage, prepareMemberPhoto } from '../file-utils.js';
import { BrandHeader, BusyOverlay, EmptyState, Field, Notice, PageTitle, StatusBadge } from '../ui.jsx';

function errorText(error) { return error?.message || String(error || '오류가 발생했습니다.'); }

export default function PhotoUpload() {
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ phone: '', email: '', address: '', job: '', company: '', birth_place: '' });
  const [original, setOriginal] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [searched, setSearched] = useState(false);
  const fileInput = useRef(null);

  const changedExtras = useMemo(() => {
    if (!original) return {};
    return Object.fromEntries(Object.entries(form).filter(([key, value]) => value.trim() !== String(original[key] || '').trim()));
  }, [form, original]);
  const canSave = !!selected && (!!file || Object.keys(changedExtras).length > 0);

  async function search(e) {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name').trim();
    if (!name) return setMessage({ type: 'warning', text: '이름을 입력해 주세요.' });
    setBusy(true); setMessage(null); setSelected(null); setFile(null); setPreview(null);
    try {
      const members = await api.photoSearch(name) || [];
      setResults(members);
      setSearched(true);
      if (members.length === 1) chooseMember(members[0]);
      else if (members.length > 1) setMessage({ type: 'info', text: `${members.length}명이 조회되었습니다. 대상 회원을 선택해 주세요.` });
    } catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  function chooseMember(member) {
    const values = {
      phone: member.phone || '', email: member.email || '', address: member.address || '',
      job: member.job || '', company: member.company || '', birth_place: member.birth_place || '',
    };
    setSelected(member); setForm(values); setOriginal(values); clearFile();
  }

  async function chooseFile(nextFile) {
    if (!nextFile) return;
    setMessage(null);
    try {
      if (!isAllowedImage(nextFile)) throw new Error('JPG, PNG, GIF, WEBP 사진만 선택할 수 있습니다.');
      if (nextFile.size > 15 * 1024 * 1024) throw new Error(`파일이 너무 큽니다. 현재 ${formatBytes(nextFile.size)}, 최대 15MB입니다.`);
      const size = await getImageSize(nextFile);
      if (size.width < 400 || size.height < 600) throw new Error(`해상도가 너무 작습니다. 현재 ${size.width}×${size.height}px, 최소 400×600px가 필요합니다.`);
      clearFile();
      setFile(nextFile);
      setPreview({ url: URL.createObjectURL(nextFile), ...size });
      setMessage({ type: 'success', text: '사진이 준비되었습니다. 내용을 확인한 뒤 저장해 주세요.' });
    } catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
  }

  function clearFile() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setFile(null); setPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function save(e) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setMessage({ type: 'info', text: file ? '사진을 최적화하고 전송하고 있습니다…' : '회원 정보를 저장하고 있습니다…' });
    try {
      let prepared = { dataUrl: '', name: '' };
      if (file) prepared = await prepareMemberPhoto(file);
      let result;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          result = await api.uploadPhoto({
            memberId: selected.member_id,
            base64Data: prepared.dataUrl,
            fileName: prepared.name,
            uploader: 'REACT_PHOTO_TOOL',
            memberName: selected.name,
            extras: changedExtras,
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3 && /network|timeout|시간|일시|연결/i.test(errorText(error))) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          } else throw error;
        }
      }
      if (!result) throw lastError;
      const saved = [file ? '사진' : '', Object.keys(changedExtras).length ? '정보' : ''].filter(Boolean).join(' + ');
      setOriginal(form);
      setSelected((member) => ({ ...member, ...form, has_photo: member.has_photo || !!file }));
      clearFile();
      setMessage({ type: 'success', text: result.immediate_processed ? `${selected.name}님의 ${saved}가 바로 반영되었습니다.` : `${selected.name}님의 ${saved}가 접수되었습니다. 최대 1분 이내에 반영됩니다.` });
    } catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  return (
    <main className="shell shell-narrow">
      <BrandHeader title="사진·정보 수정" subtitle="Member profile update" actions={<><a className="header-link" href="#/">회원관리</a><a className="header-link" href="#/member-card">회원카드</a></>} />
      <PageTitle eyebrow="Profile update" title="회원 사진과 정보 수정" description="이름으로 회원을 찾은 뒤 사진 또는 연락처 정보를 빠르게 갱신합니다." />
      {message && <Notice type={message.type} onClose={() => setMessage(null)}>{message.text}</Notice>}

      <section className="card">
        <div className="card-header"><h2>1. 회원 조회</h2></div>
        <form className="search-bar" onSubmit={search}><input name="name" placeholder="등록된 이름을 정확히 입력하세요" autoComplete="off" /><button className="button primary">조회</button></form>
        <div className="result-list">
          {results.map((member) => <PhotoSearchResult key={member.member_id} member={member} selected={selected?.member_id === member.member_id} onClick={() => chooseMember(member)} />)}
          {searched && !results.length && <EmptyState title="일치하는 회원이 없습니다" description="띄어쓰기를 포함해 등록된 이름과 같은지 확인해 주세요." />}
        </div>
      </section>

      {selected && (
        <form className="card" onSubmit={save}>
          <div className="card-header"><h2>2. 수정 내용</h2><StatusBadge tone={selected.has_photo ? 'success' : 'warning'}>{selected.has_photo ? '기존 사진 있음' : '사진 없음'}</StatusBadge></div>
          <SelectedPhotoMember member={selected} />
          <div className="form-grid">
            <Field label="전화번호"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="이메일"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="주소" className="full"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="직업"><input value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })} /></Field>
            <Field label="직장명"><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="출생지" required className="full"><input value={form.birth_place} onChange={(e) => setForm({ ...form, birth_place: e.target.value })} placeholder="예: 전라북도 완주군" /></Field>
          </div>

          <div className="section-head"><div><h2>회원 사진</h2><p>큰 사진은 화질을 유지하는 범위에서 자동으로 가볍게 전송됩니다.</p></div></div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => chooseFile(e.target.files?.[0])} />
          {!preview ? (
            <button className={`drop-zone ${dragging ? 'dragging' : ''}`} type="button" onClick={() => fileInput.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}>
              <span><strong>사진을 선택하거나 이곳에 놓아주세요</strong><small>JPG · PNG · GIF · WEBP / 최소 400×600px / 최대 15MB</small></span>
            </button>
          ) : (
            <div className="photo-preview"><img src={preview.url} alt="새 사진 미리보기" /><div><strong>{file.name}</strong><p>{preview.width} × {preview.height}px</p><p>{formatBytes(file.size)}</p><button type="button" className="button ghost compact" onClick={clearFile}>다른 사진 선택</button></div></div>
          )}
          <div className="button-row end"><button type="submit" className="button primary" disabled={!canSave}>변경 내용 저장</button></div>
        </form>
      )}
      <BusyOverlay show={busy} label="처리하고 있습니다" />
    </main>
  );
}

function PhotoSearchResult({ member, selected, onClick }) {
  return (
    <button type="button" className="result-item" onClick={onClick} aria-pressed={selected}>
      <span className="member-avatar">{member.name?.slice(0, 1)}</span>
      <span className="result-main"><strong>{member.name}</strong> {selected && <StatusBadge tone="success">선택됨</StatusBadge>}<p>회원번호 {member.member_id} · {member.dept_name || '-'} · {member.status || '-'} · {member.rank || '-'}</p></span>
      <span className="result-arrow">›</span>
    </button>
  );
}

function SelectedPhotoMember({ member }) {
  const thumb = driveThumbnail(member.photo, 240);
  return (
    <div className="photo-member-card">
      <span className="member-avatar">{thumb ? <img src={thumb} alt="기존 회원 사진" /> : member.name?.slice(0, 1)}</span>
      <div><strong>{member.name}</strong> · 회원번호 {member.member_id}<p style={{ margin: '5px 0', color: 'var(--muted)', fontSize: 12 }}>{member.dept_name || '소속미정'} · {member.rank || '법계 미등록'}</p><small>{member.photo ? '새 사진을 저장하면 기존 사진이 교체됩니다.' : '현재 등록된 사진이 없습니다.'}</small></div>
    </div>
  );
}
