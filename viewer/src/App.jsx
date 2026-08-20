import { useState } from 'react';
import { driveThumbnail, searchByName } from './api.js';

function errorText(error) { return error?.message || String(error || '오류가 발생했습니다.'); }

export default function App() {
  const [keyword, setKeyword] = useState('');
  const [members, setMembers] = useState([]);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    const name = keyword.trim();
    if (!name) { setError('이름을 입력해 주세요.'); return; }

    setBusy(true); setError(''); setMembers([]); setSearched('');
    try {
      setMembers(await searchByName(name));
      setSearched(name);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark">YW</span>
        <span><strong>회원조회</strong><small>이름으로 회원 정보를 확인합니다</small></span>
      </header>

      <form className="search-bar" onSubmit={onSubmit}>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="회원 이름"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          aria-label="회원 이름"
        />
        <button type="submit" className="button" disabled={busy}>{busy ? '조회 중' : '조회'}</button>
      </form>
      <p className="search-hint">이름 전체를 정확히 입력해 주세요. 동명이인은 모두 표시됩니다.</p>

      {error && <div className="notice error" role="alert">{error}</div>}

      {busy && <div className="result-list">{[0, 1].map((i) => <div key={i} className="skeleton-row" />)}</div>}

      {!busy && searched && (
        members.length ? (
          <>
            <p className="result-count">{`"${searched}" 조회 결과 ${members.length}명`}</p>
            <ul className="result-list">
              {members.map((member, index) => <MemberRow key={`${member.member_id}-${index}`} member={member} />)}
            </ul>
          </>
        ) : (
          <div className="empty-state">
            <strong>조회 결과가 없습니다</strong>
            <p>{`"${searched}"과 정확히 일치하는 회원이 없습니다. 이름을 다시 확인해 주세요.`}</p>
          </div>
        )
      )}
    </main>
  );
}

function MemberRow({ member }) {
  const photo = driveThumbnail(member.photo, 240);
  return (
    <li className="result-row">
      <div className="photo">
        {photo
          ? <img src={photo} alt={`${member.name} 사진`} loading="lazy" referrerPolicy="no-referrer" />
          : <span className="photo-empty">사진<br />없음</span>}
      </div>
      <dl className="info">
        <div className="info-name">{member.name || '-'}</div>
        <div className="info-row"><dt>회원번호</dt><dd>{member.member_id || '-'}</dd></div>
        <div className="info-row"><dt>소속</dt><dd>{member.dept_name || '-'}</dd></div>
        <div className="info-row"><dt>법계</dt><dd>{member.rank || '-'}</dd></div>
      </dl>
    </li>
  );
}
