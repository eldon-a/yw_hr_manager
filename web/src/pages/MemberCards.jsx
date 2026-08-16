import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { driveThumbnail } from '../file-utils.js';
import { BrandHeader, BusyOverlay, EmptyState, Notice, PageTitle } from '../ui.jsx';

function errorText(error) { return error?.message || String(error || '오류가 발생했습니다.'); }

export default function MemberCards() {
  const [filters, setFilters] = useState({ departments: [], ranks: [], statuses: [] });
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [ranks, setRanks] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [sortBy, setSortBy] = useState('member_id');
  const [showNameCheck, setShowNameCheck] = useState(false);
  const [members, setMembers] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [query, setQuery] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('회원카드 정보를 불러오는 중입니다');
  const [message, setMessage] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.memberCardFilters().then((data) => setFilters(data || { departments: [], ranks: [], statuses: [] }))
      .catch((error) => setMessage({ type: 'error', text: errorText(error) }));
  }, []);

  async function loadCards(mode, keyword, nextSort = sortBy) {
    setBusyLabel('회원카드 정보를 불러오는 중입니다'); setBusy(true); setMessage(null); setExcluded([]);
    try {
      const list = await api.cardData(mode, keyword, nextSort) || [];
      setMembers(list); setQuery({ mode, keyword }); setLoaded(true);
      setMessage({ type: 'success', text: `${list.length}명을 불러왔습니다.` });
    } catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function changeSort(nextSort) {
    setSortBy(nextSort);
    if (query) await loadCards(query.mode, query.keyword, nextSort);
  }

  function runNameSearch(e) {
    e.preventDefault();
    if (!name.trim()) return setMessage({ type: 'warning', text: '이름을 입력해 주세요.' });
    loadCards('name', name.trim());
  }
  function runDepartment() {
    if (!department) return setMessage({ type: 'warning', text: '부서를 선택해 주세요.' });
    loadCards('dept', department);
  }
  function runRanks() {
    if (!ranks.length) return setMessage({ type: 'warning', text: '법계를 하나 이상 선택해 주세요.' });
    loadCards('ranks', ranks.join(','));
  }
  function runStatuses() {
    if (!statuses.length) return setMessage({ type: 'warning', text: '회원상태를 하나 이상 선택해 주세요.' });
    loadCards('statuses', statuses.join(','));
  }
  function toggle(list, setter, value) { setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]); }
  function toggleExcluded(id) { setExcluded((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]); }

  async function createPdf() {
    const mode = query?.mode || 'all';
    const keyword = query?.keyword || '';
    setBusy(true); setBusyLabel('PDF 생성을 준비하고 있습니다'); setMessage(null);
    let batchIndex = 0;
    let jobId = '';
    try {
      while (true) {
        const result = await api.cardPdfBatch({ mode, keyword, batchIndex, excludeIds: excluded, sortBy, showNameCheck, jobId });
        if (result.done) {
          setMessage({ type: 'success', text: `PDF 생성 완료: ${result.total}명, ${result.batches}개 파일` });
          if (result.folderUrl) window.open(result.folderUrl, '_blank', 'noopener,noreferrer');
          break;
        }
        jobId = result.jobId || jobId;
        batchIndex = result.nextBatch;
        const percent = Math.round((result.processed / result.totalMembers) * 100);
        setBusyLabel(`PDF 생성 중 · ${result.processed}/${result.totalMembers}명 (${percent}%)`);
      }
    } catch (error) { setMessage({ type: 'error', text: `PDF 생성 실패: ${errorText(error)}` }); }
    finally { setBusy(false); }
  }

  return (
    <main className="shell shell-wide">
      <BrandHeader title="회원카드" subtitle="Print & PDF" actions={<><a className="header-link" href="#/">회원관리</a><a className="header-link" href="#/photo">사진·정보</a></>} />
      <PageTitle eyebrow="Member cards" title="회원 카드 인쇄·PDF" description="이름, 부서, 법계 또는 회원상태로 조회한 뒤 인쇄 대상을 선택할 수 있습니다." side={<button type="button" className="button primary" onClick={() => loadCards('all', '')}>전체 회원 조회</button>} />
      {message && <Notice type={message.type} onClose={() => setMessage(null)}>{message.text}</Notice>}

      <section className="card filter-panel">
        <div className="filter-row"><div className="filter-label">이름</div><form className="search-bar" onSubmit={runNameSearch}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="정확한 이름" /><button className="button secondary">이름 검색</button></form></div>
        <div className="filter-row"><div className="filter-label">부서</div><div className="button-row" style={{ margin: 0 }}><select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ maxWidth: 320 }}><option value="">부서 선택</option>{filters.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><button type="button" className="button secondary" onClick={runDepartment}>부서 조회</button></div></div>
        <div className="filter-row"><div className="filter-label">법계</div><div><div className="chip-group">{filters.ranks.map((rank) => <button type="button" key={rank.name} className={`chip ${ranks.includes(rank.name) ? 'active' : ''}`} onClick={() => toggle(ranks, setRanks, rank.name)}>{rank.name}<small>{rank.count}</small></button>)}</div><button type="button" className="button soft compact" style={{ marginTop: 9 }} onClick={runRanks}>선택 법계 조회</button></div></div>
        <div className="filter-row"><div className="filter-label">회원상태</div><div><div className="chip-group">{filters.statuses.map((status) => <button type="button" key={status.name} className={`chip ${statuses.includes(status.name) ? 'active' : ''}`} onClick={() => toggle(statuses, setStatuses, status.name)}>{status.name}<small>{status.count}</small></button>)}</div><button type="button" className="button soft compact" style={{ marginTop: 9 }} onClick={runStatuses}>선택 상태 조회</button></div></div>
        <div className="filter-row"><div className="filter-label">출력 옵션</div><div className="chip-group"><button type="button" className={`chip ${sortBy === 'member_id' ? 'active' : ''}`} onClick={() => changeSort('member_id')}>회원번호순</button><button type="button" className={`chip ${sortBy === 'name' ? 'active' : ''}`} onClick={() => changeSort('name')}>가나다순</button><button type="button" className={`chip ${showNameCheck ? 'active' : ''}`} onClick={() => setShowNameCheck((value) => !value)}>이름 옆 체크박스</button></div></div>
      </section>

      <div className="cards-toolbar">
        <p>{loaded ? `조회 ${members.length}명 · PDF 제외 ${excluded.length}명` : '조회 조건을 선택하거나 전체 회원을 불러와 주세요.'}</p>
        <div className="button-row"><button type="button" className="button ghost" disabled={!members.length} onClick={() => window.print()}>인쇄</button><button type="button" className="button primary" disabled={!members.length || excluded.length === members.length} onClick={createPdf}>PDF 만들기</button></div>
      </div>
      <section className="member-cards">
        {members.map((member, index) => <MemberCard key={`${member.member_id}-${index}`} member={member} excluded={excluded.includes(member.member_id)} showNameCheck={showNameCheck} onExclude={() => toggleExcluded(member.member_id)} />)}
        {loaded && !members.length && <EmptyState title="조회 결과가 없습니다" description="다른 조건으로 다시 조회해 주세요." />}
      </section>
      <BusyOverlay show={busy} label={busyLabel} />
    </main>
  );
}

function MemberCard({ member, excluded, showNameCheck, onExclude }) {
  const photo = driveThumbnail(member.photo, 260);
  return (
    <div className={`card-wrapper ${excluded ? 'excluded' : ''}`}>
      <div className="card-exclude"><label><input type="checkbox" checked={excluded} onChange={onExclude} />PDF 제외</label></div>
      <table className="member-card-table">
        <colgroup><col style={{ width: 105 }} /><col style={{ width: 56 }} /><col style={{ width: 84 }} /><col style={{ width: 56 }} /><col style={{ width: 84 }} /><col style={{ width: 60 }} /><col style={{ width: 105 }} /><col /></colgroup>
        <tbody>
          <tr><td className="photo-cell" rowSpan="4">{photo ? <img src={photo} alt={`${member.name} 사진`} /> : '사진 없음'}</td><td className="label-cell">이름</td><td className="name-value">{member.name}{showNameCheck && <span className="name-check-box" />}</td><td className="label-cell">법계</td><td>{member.rank}</td><td className="label-cell">생년월일</td><td>{member.birth}</td><td className="wide-cell" rowSpan="2"><small>출생지</small><br />{member.birth_place}</td></tr>
          <tr><td className="label-cell">법명</td><td>{member.dharma_name}</td><td className="label-cell">소개자</td><td>{member.referrer}</td><td className="label-cell">나이</td><td>{member.age}</td></tr>
          <tr><td className="label-cell">소속</td><td>{member.dept_name}</td><td className="label-cell">직업</td><td>{member.job}</td><td className="label-cell">입회일</td><td>{member.join_date}</td><td className="wide-cell" rowSpan="2"><small>주소</small><br />{member.address}</td></tr>
          <tr><td className="label-cell">회원번호</td><td>{member.member_id}</td><td className="label-cell">직장</td><td>{member.company}</td><td className="label-cell">전화번호</td><td>{member.phone}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
