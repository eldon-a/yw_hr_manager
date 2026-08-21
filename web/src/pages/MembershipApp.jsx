import { useEffect, useMemo, useRef, useState } from 'react';
import { api, clearStaffSession, readStaffSession } from '../api.js';
import { driveThumbnail, fileToDataUrl, isAllowedImage, prepareMemberPhoto } from '../file-utils.js';
import {
  BrandHeader,
  BusyOverlay,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Notice,
  PageTitle,
  StatusBadge,
} from '../ui.jsx';

const EMPTY_USER = { role: 'GUEST', userName: '', email: '' };
const REQUEST_LABELS = { TRANSFER: '부서 이동', UPDATE: '정보 수정', WITHDRAW: '탈퇴 신청' };

function errorText(error) {
  return error?.message || String(error || '알 수 없는 오류가 발생했습니다.');
}

function appHeader(user) {
  const actions = (
    <>
      <a className="header-link" href="#/photo">사진·정보</a>
      <a className="header-link" href="#/member-card">회원카드</a>
      {user?.role && user.role !== 'GUEST' && <span className="header-link active">{user.userName || '로그인'}님</span>}
    </>
  );
  return <BrandHeader title="회원관리" subtitle="Yangwoo member services" actions={actions} />;
}

export default function MembershipApp() {
  // 새로고침해도 탭에 남아 있는 담당자 세션을 그대로 이어서 사용한다.
  const [restored] = useState(readStaffSession);
  const [screen, setScreen] = useState(restored ? 'staffHome' : 'home');
  const [user, setUser] = useState(restored
    ? { role: restored.role, userName: restored.userName, email: restored.email }
    : EMPTY_USER);
  const [departments, setDepartments] = useState(restored?.departments || []);
  const [headers, setHeaders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [memberCandidates, setMemberCandidates] = useState([]);
  const [requestType, setRequestType] = useState('UPDATE');
  const [consentOptional, setConsentOptional] = useState(false);
  const [needsReconsent, setNeedsReconsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('처리하고 있습니다');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const prefetch = () => api.departments().then(setDepartments).catch(() => {});
    const timer = window.requestIdleCallback ? window.requestIdleCallback(prefetch) : setTimeout(prefetch, 700);
    return () => window.cancelIdleCallback ? window.cancelIdleCallback(timer) : clearTimeout(timer);
  }, []);

  // 세션이 끊긴 뒤 같은 오류가 계속 뜨지 않도록 곧바로 로그인 화면으로 돌려보낸다.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => {
    const onSessionExpired = (event) => {
      const role = userRef.current?.role;
      if (role !== 'ADMIN' && role !== 'DEPT_HEAD') return;
      setUser(EMPTY_USER);
      setSelected(null);
      setScreen('staffLogin');
      setNotice({ type: 'warning', text: event.detail?.message || '로그인이 만료되었습니다. 다시 로그인해 주세요.' });
    };
    window.addEventListener('hrm:session-expired', onSessionExpired);
    return () => window.removeEventListener('hrm:session-expired', onSessionExpired);
  }, []);

  async function withBusy(label, task) {
    setBusyLabel(label);
    setBusy(true);
    setNotice(null);
    try { return await task(); }
    catch (error) { setNotice({ type: 'error', text: errorText(error) }); throw error; }
    finally { setBusy(false); }
  }

  async function ensureDepartments() {
    if (departments.length) return departments;
    const list = await api.departments();
    setDepartments(list || []);
    return list || [];
  }

  async function ensureHeaders() {
    if (headers.length) return headers;
    const list = await api.memberHeaders();
    setHeaders(list || []);
    return list || [];
  }

  function goHome(message) {
    setScreen('home');
    setSelected(null);
    setRequestType('UPDATE');
    if (message) setNotice({ type: 'success', text: message });
  }

  async function openMemberAuth() {
    try {
      await withBusy('회원 확인 화면을 준비하고 있습니다', () => Promise.all([ensureDepartments(), ensureHeaders()]));
      setMemberCandidates([]);
      setScreen('memberAuth');
    } catch (_) { /* notice already set */ }
  }

  async function openJoinForm(optional) {
    try {
      await withBusy('가입 양식을 준비하고 있습니다', ensureDepartments);
      setConsentOptional(optional);
      setScreen('join');
    } catch (_) { /* notice already set */ }
  }

  async function handleMemberLookup(credentials) {
    try {
      const candidates = await withBusy('회원 후보를 확인하고 있습니다', () =>
        api.selfCandidates(credentials.name, credentials.memberId, credentials.departmentName));
      if (!candidates.length) {
        setMemberCandidates([]);
        setNotice({ type: 'warning', text: '입력한 이름과 부서에 일치하는 회원이 없습니다.' });
        return;
      }
      if (candidates.length === 1) {
        await handleMemberCandidate(candidates[0]);
        return;
      }
      setMemberCandidates(candidates);
      setNotice({ type: 'info', text: `동명이인 ${candidates.length}명이 조회되었습니다. 본인을 선택해 주세요.` });
    } catch (_) { /* notice already set */ }
  }

  async function handleMemberCandidate(candidate) {
    try {
      const member = await withBusy('회원 정보를 불러오고 있습니다', () =>
        api.verifyMember(candidate.name, candidate.member_id, candidate.dept_name));
      setMemberCandidates([]);
      setUser({ role: 'SELF', userName: member.name, email: 'SELF' });
      setSelected(member);
      setRequestType('UPDATE');
      if (!member.has_consented) setNeedsReconsent(true);
      else setScreen('request');
    } catch (_) { /* notice already set */ }
  }

  async function handleReconsent() {
    try {
      await withBusy('동의 내용을 반영하고 있습니다', () => api.reconsent(selected.member_id));
      setNeedsReconsent(false);
      setSelected((value) => ({ ...value, has_consented: true }));
      setScreen('request');
    } catch (_) { /* notice already set */ }
  }

  async function handleStaffLogin(credentials) {
    try {
      const login = await withBusy('담당자 권한을 확인하고 있습니다', () => api.staffLogin(credentials.email, credentials.password));
      setUser(login);
      setDepartments(login.departments || []);
      setScreen('staffHome');
      ensureHeaders().catch(() => {});
    } catch (_) { /* notice already set */ }
  }

  async function openStaffSearch(type) {
    try {
      await withBusy('화면을 준비하고 있습니다', () => Promise.all([ensureDepartments(), type === 'UPDATE' ? ensureHeaders() : Promise.resolve([])]));
      setRequestType(type);
      setScreen('search');
    } catch (_) { /* notice already set */ }
  }

  function selectForRequest(member) {
    setSelected(member);
    setScreen('request');
  }

  function logout() {
    clearStaffSession();
    setUser(EMPTY_USER);
    setSelected(null);
    setNotice(null);
    setScreen('home');
  }

  return (
    <main className={`shell ${screen === 'staffHome' ? '' : 'shell-narrow'}`}>
      {appHeader(user)}
      {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      {screen === 'home' && (
        <HomeScreen
          onJoin={() => setScreen('consent')}
          onMember={openMemberAuth}
          onStaff={() => setScreen('staffLogin')}
        />
      )}
      {screen === 'consent' && <ConsentScreen onBack={() => setScreen('home')} onContinue={openJoinForm} />}
      {screen === 'join' && (
        <NewMemberForm
          departments={departments}
          user={user}
          consentOptional={consentOptional}
          onBack={() => setScreen(user.role === 'ADMIN' || user.role === 'DEPT_HEAD' ? 'staffHome' : 'home')}
          onSubmit={async (form) => {
            try {
              const result = await withBusy('가입 신청을 접수하고 있습니다', () => api.submitRequest(form));
              if (user.role === 'ADMIN' || user.role === 'DEPT_HEAD') {
                setScreen('staffHome');
                setNotice({ type: 'success', text: result || '가입 신청이 접수되었습니다.' });
              } else {
                goHome(result || '가입 신청이 접수되었습니다.');
              }
            } catch (_) { /* notice already set */ }
          }}
        />
      )}
      {screen === 'memberAuth' && <MemberAuth departments={departments} candidates={memberCandidates} onBack={() => setScreen('home')} onSubmit={handleMemberLookup} onSelect={handleMemberCandidate} />}
      {screen === 'staffLogin' && <StaffLogin onBack={() => setScreen('home')} onSubmit={handleStaffLogin} />}
      {screen === 'staffHome' && (
        <StaffHome
          user={user}
          headers={headers}
          onHeaders={ensureHeaders}
          onAction={openStaffSearch}
          onNew={async () => {
            try {
              await withBusy('가입 양식을 준비하고 있습니다', ensureDepartments);
              setScreen('join');
            } catch (_) { /* handled */ }
          }}
          onLogout={logout}
          setBusy={(show, label) => { setBusy(show); if (label) setBusyLabel(label); }}
          setNotice={setNotice}
        />
      )}
      {screen === 'search' && (
        <MemberSearch
          type={requestType}
          onBack={() => setScreen('staffHome')}
          onSelect={selectForRequest}
          setBusy={(show, label) => { setBusy(show); if (label) setBusyLabel(label); }}
          setNotice={setNotice}
        />
      )}
      {screen === 'request' && selected && (
        <MemberRequestForm
          member={selected}
          type={requestType}
          user={user}
          departments={departments}
          headers={headers}
          onBack={() => user.role === 'SELF' ? logout() : setScreen('staffHome')}
          onSubmit={async (form) => {
            try {
              const result = await withBusy('신청 내용을 전송하고 있습니다', () => api.submitRequest(form));
              if (user.role === 'SELF') {
                logout();
                setNotice({ type: 'success', text: result || '정보 수정 신청이 접수되었습니다.' });
              } else {
                setScreen('staffHome');
                setNotice({ type: 'success', text: result || '신청이 접수되었습니다.' });
              }
            } catch (_) { /* handled */ }
          }}
        />
      )}

      {needsReconsent && (
        <Modal title="개인정보 동의 갱신" onClose={() => { setNeedsReconsent(false); logout(); }}>
          <div className="consent-copy" style={{ height: 230 }}>
            <h3>수집·이용 목적</h3>
            <p>본인 확인, 회원 관리, 회비 및 증명서 관리, 행사·교육 안내와 운영을 위해 회원 정보를 이용합니다.</p>
            <h3>수집 항목 및 보유 기간</h3>
            <p>필수 항목은 성명, 성별, 생년월일, 전화번호, 주소이며 회원 탈퇴 또는 목적 달성 시까지 보유합니다.</p>
            <h3>동의 거부 권리</h3>
            <p>동의를 거부할 수 있으나 필수 항목 미동의 시 회원 서비스 이용이 제한될 수 있습니다.</p>
          </div>
          <div className="button-row end">
            <button className="button ghost" type="button" onClick={() => { setNeedsReconsent(false); logout(); }}>취소</button>
            <button className="button primary" type="button" onClick={handleReconsent}>동의하고 계속</button>
          </div>
        </Modal>
      )}
      <BusyOverlay show={busy} label={busyLabel} />
    </main>
  );
}

function HomeScreen({ onJoin, onMember, onStaff }) {
  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <h1>대승불교 양우종<br />회원관리 시스템</h1>
        </div>
      </section>
      <section className="action-grid" aria-label="시작 메뉴">
        <button className="action-card" type="button" onClick={onJoin}>
          <span className="number">01</span><h2>신규 가입 신청</h2><p>개인정보 동의 후 새 회원 등록을 신청합니다.</p><span className="arrow">→</span>
        </button>
        <button className="action-card" type="button" onClick={onMember}>
          <span className="number">02</span><h2>내 정보 수정</h2><p>본인 확인 후 연락처와 회원 정보를 변경합니다.</p><span className="arrow">→</span>
        </button>
        <button className="action-card admin" type="button" onClick={onStaff}>
          <span className="number">03</span><h2>담당자 로그인</h2><p>가입·이동·수정 요청을 검토하고 관리합니다.</p><span className="arrow">→</span>
        </button>
      </section>
    </>
  );
}

function ConsentScreen({ onBack, onContinue }) {
  const [required, setRequired] = useState(false);
  const [optional, setOptional] = useState(false);
  return (
    <section className="screen-card">
      <PageTitle eyebrow="Step 1" title="개인정보 수집·이용 동의" description="내용을 확인한 뒤 필수 항목에 동의해 주세요." />
      <div className="card">
        <div className="consent-copy">
          <h3>1. 개인정보 수집·이용 목적</h3>
          <p>본인 확인 및 회원 관리, 회원관리 시스템 등록과 유지, 회비 납부 관리, 기부금 납입 증명과 각종 증명서 발급, 행사·교육 안내와 운영, 공지사항 발송에 이용합니다.</p>
          <h3>2. 수집하는 개인정보 항목</h3>
          <p><b>필수:</b> 성명, 성별, 생년월일, 전화번호, 주소<br /><b>선택:</b> 사진, 이메일, 가족관계, 직업·학력, 소개자와 관계</p>
          <h3>3. 보유·이용 기간</h3>
          <p>원칙적으로 회원 탈퇴 또는 수집·이용 목적 달성 시까지 보유하며, 법령상 보존 의무가 있는 경우 해당 기간을 따릅니다.</p>
          <h3>4. 제3자 제공</h3><p>수집한 개인정보를 제3자에게 제공하지 않습니다.</p>
          <h3>5. 동의 거부 권리</h3>
          <p>동의를 거부할 권리가 있습니다. 다만 필수 정보 미제공 시 회원 등록과 활동 참여가 제한될 수 있으며, 선택 정보는 제공하지 않아도 불이익이 없습니다.</p>
        </div>
        <label className="check-row"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /><span><b>[필수] 개인정보 수집·이용에 동의합니다.</b><br /><small>성명, 성별, 생년월일, 전화번호, 주소</small></span></label>
        <label className="check-row"><input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /><span>[선택] 개인정보 수집·이용에 동의합니다.<br /><small>사진, 이메일, 가족관계, 직업·학력, 소개자 등</small></span></label>
        <div className="button-row end">
          <button type="button" className="button ghost" onClick={onBack}>취소</button>
          <button type="button" className="button primary" disabled={!required} onClick={() => onContinue(optional)}>다음</button>
        </div>
      </div>
    </section>
  );
}

function MemberAuth({ departments, candidates, onBack, onSubmit, onSelect }) {
  function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({ name: fd.get('name').trim(), memberId: fd.get('memberId').trim(), departmentName: fd.get('departmentName') });
  }
  return (
    <section className="screen-card">
      <PageTitle eyebrow="Member verification" title="본인 확인" description="등록된 회원 정보와 동일하게 입력해 주세요." />
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <Field label="성명" required><input name="name" autoComplete="name" placeholder="예: 홍길동" required /></Field>
          <Field label="회원번호 (선택)" hint="동명이인이 많을 때 입력하면 더 빠르게 찾을 수 있습니다."><input name="memberId" inputMode="numeric" placeholder="예: 1001" /></Field>
          <Field label="소속 부서" required className="full"><select name="departmentName" required defaultValue=""><option value="" disabled>부서를 선택하세요</option>{departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}</select></Field>
        </div>
        <div className="button-row end"><button type="button" className="button ghost" onClick={onBack}>뒤로</button><button className="button primary">회원 찾기</button></div>
        {!!candidates.length && (
          <div className="result-list" aria-label="동명이인 회원 후보">
            {candidates.map((candidate) => (
              <button type="button" className="result-item" key={candidate.member_id} onClick={() => onSelect(candidate)}>
                <span className="member-avatar">{candidate.name.slice(0, 1)}</span>
                <span className="result-main"><strong>{candidate.name}</strong> <StatusBadge tone={candidate.status === '활동' ? 'success' : 'neutral'}>{candidate.status || '상태 미정'}</StatusBadge><p>회원번호 {candidate.member_id} · {candidate.dept_name} · {candidate.rank || '법계 미등록'}</p></span>
                <span className="result-arrow">›</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </section>
  );
}

function StaffLogin({ onBack, onSubmit }) {
  function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({ email: fd.get('email').trim(), password: fd.get('password') });
  }
  return (
    <section className="screen-card">
      <PageTitle eyebrow="Staff access" title="담당자 로그인" description="승인된 관리자 또는 부서 담당자 계정으로 접속합니다." />
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <Field label="이메일" required className="full"><input type="email" name="email" autoComplete="username" placeholder="name@example.com" required /></Field>
          <Field label="비밀번호" hint="일반 계정은 필수입니다. yw_insa@tmp.com 부서담당자 계정만 생략할 수 있습니다." className="full"><input type="password" name="password" autoComplete="current-password" /></Field>
        </div>
        <div className="button-row end"><button type="button" className="button ghost" onClick={onBack}>뒤로</button><button className="button primary">로그인</button></div>
      </form>
    </section>
  );
}

function NewMemberForm({ departments, user, consentOptional, onBack, onSubmit }) {
  const [fileStatus, setFileStatus] = useState('');
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      type: 'NEW',
      target_name: fd.get('name').trim(),
      phone: fd.get('phone').trim(),
      birth: fd.get('birth'),
      lunar_solar: fd.get('lunar'),
      gender: fd.get('gender'),
      target_dept_id: fd.get('department'),
      address: fd.get('address').trim(),
      job: fd.get('job').trim(),
      company: fd.get('company').trim(),
      motive: fd.get('motive').trim(),
      referrer: fd.get('referrer').trim(),
      relation: fd.get('relation').trim(),
      birth_place: fd.get('birthPlace').trim(),
      dharma_name: fd.get('dharmaName').trim(),
      requester_email: user.email || 'GUEST',
      requester_name: user.userName || '본인',
    };
    if (user.role === 'GUEST') {
      payload.consent_mandatory = 'Y';
      payload.consent_optional = consentOptional ? 'Y' : 'N';
    }
    try {
      const photo = fd.get('photo');
      if (photo?.size) {
        setFileStatus('사진을 업로드에 맞게 준비하고 있습니다…');
        const prepared = await prepareMemberPhoto(photo);
        payload.photoData = prepared.dataUrl;
        payload.photoName = prepared.name;
      }
      const documentFile = fd.get('memberForm');
      if (documentFile?.size) {
        setFileStatus('입회원서를 읽고 있습니다…');
        payload.formData = await fileToDataUrl(documentFile);
        payload.formName = documentFile.name;
      }
      setFileStatus('');
      await onSubmit(payload);
    } catch (error) {
      setFileStatus(errorText(error));
    }
  }
  return (
    <section>
      <PageTitle eyebrow="New member" title="신규 회원 등록" description="필수 정보를 입력하면 승인 대기 목록에 안전하게 접수됩니다." />
      {fileStatus && <Notice type={fileStatus.includes('…') ? 'info' : 'error'}>{fileStatus}</Notice>}
      <form className="card" onSubmit={submit}>
        <div className="form-grid three">
          <Field label="성명" required><input name="name" autoComplete="name" required /></Field>
          <Field label="전화번호" required><input name="phone" type="tel" autoComplete="tel" required /></Field>
          <Field label="생년월일" required><input name="birth" type="date" required /></Field>
          <Field label="음력 / 양력"><select name="lunar" defaultValue="양"><option>양</option><option>음</option><option>윤</option></select></Field>
          <Field label="성별"><select name="gender" defaultValue="남"><option>남</option><option>여</option></select></Field>
          <Field label="소속 부서" required><select name="department" defaultValue="" required><option value="" disabled>부서 선택</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="주소" required className="full"><input name="address" autoComplete="street-address" required /></Field>
          <Field label="직업"><input name="job" /></Field>
          <Field label="직장명"><input name="company" /></Field>
          <Field label="입회동기"><input name="motive" /></Field>
          <Field label="소개자"><input name="referrer" /></Field>
          <Field label="소개자와의 관계"><input name="relation" /></Field>
          <Field label="출생지"><input name="birthPlace" placeholder="예: 전라북도 완주군" /></Field>
          <Field label="법명"><input name="dharmaName" /></Field>
          <Field label="회원 사진" hint="JPG·PNG·GIF·WEBP, 최소 400×600px, 최대 15MB"><input name="photo" type="file" accept=".jpg,.jpeg,.png,.gif,.webp" /></Field>
          <Field label="입회원서" hint="PDF, DOC, DOCX, HWP, HWPX"><input name="memberForm" type="file" accept=".pdf,.doc,.docx,.hwp,.hwpx" /></Field>
        </div>
        <div className="button-row end"><button type="button" className="button ghost" onClick={onBack}>취소</button><button className="button primary">등록 신청</button></div>
      </form>
    </section>
  );
}

function StaffHome({ user, headers, onHeaders, onAction, onNew, onLogout, setBusy, setNotice }) {
  return (
    <>
      <div className="staff-bar"><div><strong>{user.userName}님</strong> <StatusBadge tone={user.role === 'ADMIN' ? 'success' : 'info'}>{user.role === 'ADMIN' ? '관리자' : '부서 담당자'}</StatusBadge><br /><span>{user.email}</span></div><button type="button" className="button ghost compact" onClick={onLogout}>로그아웃</button></div>
      <PageTitle eyebrow="Staff workspace" title="업무 선택" description="회원 요청을 접수하거나 관리 도구를 실행할 수 있습니다." />
      <div className="staff-action-grid">
        <button className="staff-action" onClick={() => onAction('TRANSFER')}>부서 이동<small>회원 검색 후 이동 신청</small></button>
        <button className="staff-action" onClick={() => onAction('UPDATE')}>정보 수정<small>연락처·사진·추가 항목</small></button>
        <button className="staff-action danger" onClick={() => onAction('WITHDRAW')}>탈퇴 신청<small>사유를 기록해 승인 요청</small></button>
        <button className="staff-action" onClick={onNew}>신규 회원 대리<small>담당자가 가입 신청 접수</small></button>
      </div>
      {user.role === 'ADMIN' && <AdminDashboard user={user} headers={headers} onHeaders={onHeaders} setBusy={setBusy} setNotice={setNotice} />}
    </>
  );
}

function MemberSearch({ type, onBack, onSelect, setBusy, setNotice }) {
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const keyword = new FormData(e.currentTarget).get('keyword').trim();
    if (keyword.length < 2) return setNotice({ type: 'warning', text: '이름 또는 회원번호를 두 글자 이상 입력해 주세요.' });
    setBusy(true, '회원 정보를 검색하고 있습니다');
    try {
      setResults(await api.searchMembers(keyword) || []);
      setSearched(true);
      setNotice(null);
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }
  return (
    <section className="screen-card">
      <PageTitle eyebrow={REQUEST_LABELS[type]} title="회원 검색" description="성명 또는 회원번호를 입력하고 대상 회원을 선택해 주세요." />
      <div className="card">
        <form className="search-bar" onSubmit={submit}><input name="keyword" placeholder="성명 또는 회원번호" autoFocus /><button className="button primary">검색</button></form>
        <div className="result-list">
          {results.map((member) => <MemberResult key={member.member_id} member={member} onClick={() => onSelect(member)} />)}
          {searched && !results.length && <EmptyState title="검색 결과가 없습니다" description="입력한 이름이나 회원번호를 다시 확인해 주세요." />}
        </div>
        <div className="button-row"><button type="button" className="button ghost" onClick={onBack}>업무 메뉴로</button></div>
      </div>
    </section>
  );
}

function MemberResult({ member, onClick }) {
  const thumb = driveThumbnail(member.photo, 120);
  return (
    <button type="button" className="result-item" onClick={onClick}>
      <span className="member-avatar">{thumb ? <img src={thumb} alt="" /> : String(member.name || '?').slice(0, 1)}</span>
      <span className="result-main"><strong>{member.name}</strong> <StatusBadge tone={member.status === '활동' ? 'success' : 'neutral'}>{member.status || '상태 미정'}</StatusBadge><p>회원번호 {member.member_id} · {member.dept_name || '소속미정'} · {member.rank || '법계 미등록'} · {member.age || '-'}세</p></span>
      <span className="result-arrow">›</span>
    </button>
  );
}

function MemberRequestForm({ member, type, user, departments, headers, onBack, onSubmit }) {
  const [extras, setExtras] = useState([{ id: Date.now(), key: '', value: '', file: null }]);
  const [fileMessage, setFileMessage] = useState('');
  const blockedHeaders = useMemo(() => new Set(['회원번호','성명','전화번호','E-mail','주소','직업','직장명','생일','남/여','양/음','나이','법명','회원구분','회원상태','본원/지부','부서ID','updated_at','사진','consent_status','consent_granted_at']), []);
  const dynamicOptions = useMemo(() => {
    const fixed = [
      ['dept_name', '부서명', 'select'], ['type', '회원구분', 'select'], ['gender', '남/여', 'select'],
      ['lunar_solar', '양/음', 'select'], ['status', '회원상태', 'select'], ['birth', '생일', 'date'],
    ];
    const dynamic = (headers || []).filter((h) => !blockedHeaders.has(h)).map((h) => [h, h, h === '입회원서' ? 'file' : 'text']);
    return [...fixed, ...dynamic.filter((d) => !fixed.some((f) => f[0] === d[0]))];
  }, [headers, blockedHeaders]);

  function updateExtra(id, patch) { setExtras((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row)); }
  function choiceValues(key) {
    if (key === 'dept_name') return departments.map((d) => d.name);
    if (key === 'type') return ['승려', '신도'];
    if (key === 'gender') return ['남', '여'];
    if (key === 'lunar_solar') return ['양', '음'];
    if (key === 'status') return ['활동', '명목', '명예', '탈퇴', '자격정지'];
    return [];
  }
  async function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      type, member_id: member.member_id, name: member.name, current_dept_id: member.dept_id || '',
      requester_email: user.email, requester_name: user.userName,
    };
    try {
      if (type === 'TRANSFER') {
        payload.target_dept_id = fd.get('targetDepartment');
        payload.reason = '부서이동';
      } else if (type === 'WITHDRAW') {
        payload.reason = fd.get('reason').trim();
      } else {
        Object.assign(payload, {
          phone: fd.get('phone').trim(), email: fd.get('email').trim(), address: fd.get('address').trim(),
          job: fd.get('job').trim(), company: fd.get('company').trim(), birth_place: fd.get('birthPlace').trim(),
          dharma_name: fd.get('dharmaName').trim(), reason: '정보수정',
        });
        for (const row of extras) {
          if (!row.key) continue;
          if (row.key === '입회원서' && row.file?.size) {
            setFileMessage('입회원서를 준비하고 있습니다…');
            payload.formData = await fileToDataUrl(row.file);
            payload.formName = row.file.name;
          } else if (row.value) payload[row.key] = row.value;
        }
        const photo = fd.get('photo');
        if (photo?.size) {
          if (!isAllowedImage(photo)) throw new Error('지원하지 않는 사진 형식입니다.');
          setFileMessage('사진을 업로드에 맞게 준비하고 있습니다…');
          const prepared = await prepareMemberPhoto(photo);
          payload.photoData = prepared.dataUrl;
          payload.photoName = prepared.name;
        }
      }
      setFileMessage('');
      await onSubmit(payload);
    } catch (error) { setFileMessage(errorText(error)); }
  }

  const thumb = driveThumbnail(member.photo, 220);
  return (
    <section className="screen-card">
      <PageTitle eyebrow={REQUEST_LABELS[type]} title="신청서 작성" description="선택한 회원과 변경할 내용을 확인해 주세요." />
      {fileMessage && <Notice type={fileMessage.includes('…') ? 'info' : 'error'}>{fileMessage}</Notice>}
      <form className="card" onSubmit={submit}>
        <div className="selected-member"><span className="member-avatar">{thumb ? <img src={thumb} alt="" /> : member.name.slice(0,1)}</span><div><strong>{member.name}</strong> · {member.member_id}<p>{member.dept_name || '소속미정'} · {member.rank || '법계 미등록'}</p></div></div>
        {type === 'TRANSFER' && <Field label="이동할 부서" required><select name="targetDepartment" defaultValue="" required><option value="" disabled>부서 선택</option>{departments.filter((d) => String(d.id) !== String(member.dept_id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
        {type === 'WITHDRAW' && <Field label="탈퇴 사유" required><textarea name="reason" placeholder="탈퇴 사유를 입력해 주세요." required /></Field>}
        {type === 'UPDATE' && (
          <>
            <div className="form-grid">
              <Field label="전화번호"><input name="phone" defaultValue={member.phone || ''} /></Field>
              <Field label="이메일"><input name="email" type="email" defaultValue={member.email || ''} /></Field>
              <Field label="주소" className="full"><input name="address" defaultValue={member.address || ''} /></Field>
              <Field label="직업"><input name="job" defaultValue={member.job || ''} /></Field>
              <Field label="직장명"><input name="company" defaultValue={member.company || ''} /></Field>
              <Field label="출생지"><input name="birthPlace" defaultValue={member.birth_place || ''} /></Field>
              <Field label="법명"><input name="dharmaName" defaultValue={member.dharma_name || ''} /></Field>
              <Field label="사진 교체" hint={member.photo ? '새 파일을 선택하면 기존 사진이 교체됩니다.' : '현재 등록된 사진이 없습니다.'} className="full"><input name="photo" type="file" accept=".jpg,.jpeg,.png,.gif,.webp" /></Field>
            </div>
            <div className="subtle-panel">
              <h3>기타 항목 수정</h3><p>생일·부서명·회원구분 또는 시트의 다른 항목을 추가로 변경할 수 있습니다.</p>
              <div className="extra-list">
                {extras.map((row) => {
                  const config = dynamicOptions.find((item) => item[0] === row.key);
                  const values = choiceValues(row.key);
                  return (
                    <div className="extra-row" key={row.id}>
                      <select value={row.key} onChange={(e) => updateExtra(row.id, { key: e.target.value, value: '', file: null })}><option value="">항목 선택</option>{dynamicOptions.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
                      {config?.[2] === 'select' ? <select value={row.value} onChange={(e) => updateExtra(row.id, { value: e.target.value })}><option value="">변경값 선택</option>{values.map((value) => <option key={value}>{value}</option>)}</select>
                        : config?.[2] === 'date' ? <input type="date" value={row.value} onChange={(e) => updateExtra(row.id, { value: e.target.value })} />
                        : config?.[2] === 'file' ? <input type="file" accept=".pdf,.doc,.docx,.hwp,.hwpx" onChange={(e) => updateExtra(row.id, { file: e.target.files?.[0] || null })} />
                        : <input value={row.value} disabled={!row.key} placeholder="변경값" onChange={(e) => updateExtra(row.id, { value: e.target.value })} />}
                      <button type="button" className="button ghost compact" aria-label="항목 삭제" onClick={() => setExtras((rows) => rows.length === 1 ? [{ id: Date.now(), key: '', value: '', file: null }] : rows.filter((item) => item.id !== row.id))}>삭제</button>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="button soft compact" style={{ marginTop: 10 }} onClick={() => setExtras((rows) => [...rows, { id: Date.now() + Math.random(), key: '', value: '', file: null }])}>+ 항목 추가</button>
            </div>
          </>
        )}
        <div className="button-row end"><button type="button" className="button ghost" onClick={onBack}>취소</button><button className={`button ${type === 'WITHDRAW' ? 'danger' : 'primary'}`}>신청 제출</button></div>
      </form>
    </section>
  );
}

function AdminDashboard({ user, headers, onHeaders, setBusy, setNotice }) {
  const [requests, setRequests] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [auditMode, setAuditMode] = useState('PERIOD');
  const [auditRows, setAuditRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);

  async function loadRequests() {
    setBusy(true, '승인 대기 목록을 불러오는 중입니다');
    try { setRequests(await api.pendingRequests() || []); setLoaded(true); setNotice(null); }
    catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }
  useEffect(() => { loadRequests(); onHeaders().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function processRequest() {
    if (!confirm) return;
    setBusy(true, confirm.decision === 'APPROVE' ? '요청을 승인하고 있습니다' : '요청을 반려하고 있습니다');
    try {
      const result = await api.processRequest(confirm.item.request_id, confirm.decision, user.email);
      setRequests((items) => items.filter((item) => item.request_id !== confirm.item.request_id));
      setNotice({ type: 'success', text: result });
      setConfirm(null);
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function runAudit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const p1 = auditMode === 'PERIOD' ? fd.get('start') : fd.get('memberName');
    const p2 = auditMode === 'PERIOD' ? fd.get('end') : fd.get('memberId');
    if (!p1 && !p2) return setNotice({ type: 'warning', text: '조회 조건을 입력해 주세요.' });
    setBusy(true, '변경 이력을 조회하고 있습니다');
    try { setAuditRows(await api.audit(auditMode, p1, p2, fd.get('header')) || []); }
    catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function runBulk(e, mode) {
    e.preventDefault();
    const fileId = new FormData(e.currentTarget).get('fileId').trim();
    if (!fileId) return setNotice({ type: 'warning', text: '구글시트 URL 또는 파일 ID를 입력해 주세요.' });
    setBusy(true, mode === 'update' ? '외부 파일로 일괄 수정 중입니다' : '외부 파일을 일괄 등록 중입니다');
    try {
      const result = mode === 'update' ? await api.bulkUpdate(fileId, user.email) : await api.bulkRegister(fileId, user.email);
      setNotice({ type: 'success', text: result });
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function exportExcel(e) {
    e.preventDefault();
    const selectedHeaders = new FormData(e.currentTarget).getAll('headers');
    if (!selectedHeaders.length) return setNotice({ type: 'warning', text: '내보낼 항목을 하나 이상 선택해 주세요.' });
    setBusy(true, '엑셀 파일을 만들고 있습니다');
    try {
      const url = await api.exportExcel(selectedHeaders);
      window.open(url, '_blank', 'noopener,noreferrer');
      setNotice({ type: 'success', text: '엑셀 파일이 준비되었습니다.' });
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="admin-layout">
      <section>
        <div className="section-head"><div><h2>승인 대기</h2><p>최근 요청부터 표시됩니다.</p></div><button type="button" className="button ghost compact" onClick={loadRequests}>새로고침</button></div>
        <div className="request-list">
          {requests.map((item) => <RequestCard key={item.request_id} item={item} onDetail={() => setDetail(item)} onDecision={(decision) => setConfirm({ item, decision })} />)}
          {loaded && !requests.length && <EmptyState title="대기 중인 요청이 없습니다" description="새 요청이 접수되면 이곳에 표시됩니다." />}
        </div>
      </section>
      <aside className="admin-stack">
        <section className="card">
          <div className="card-header"><h3>변경 이력</h3></div>
          <div className="tab-row"><button type="button" className={auditMode === 'PERIOD' ? 'active' : ''} onClick={() => setAuditMode('PERIOD')}>기간별</button><button type="button" className={auditMode === 'MEMBER' ? 'active' : ''} onClick={() => setAuditMode('MEMBER')}>회원별</button></div>
          <form onSubmit={runAudit} style={{ marginTop: 12 }}>
            {auditMode === 'PERIOD' ? <div className="form-grid"><Field label="시작일"><input type="date" name="start" required /></Field><Field label="종료일"><input type="date" name="end" required /></Field></div> : <div className="form-grid"><Field label="성명"><input name="memberName" /></Field><Field label="회원번호"><input name="memberId" /></Field></div>}
            <Field label="조회 항목" className="full"><select name="header"><option value="ALL">전체 항목</option>{headers.map((h) => <option key={h}>{h}</option>)}</select></Field>
            <button className="button secondary block" style={{ marginTop: 10 }}>이력 검색</button>
          </form>
          <div className="audit-list">{auditRows.map((row, index) => <div className="audit-item" key={`${row.date}-${index}`}><strong>{row.date} · {row.member_id} · {row.event}</strong><span>{row.content || row.details || row.reason || row.new_val}</span></div>)}</div>
        </section>
        <section className="card">
          <div className="card-header"><h3>외부 파일 처리</h3></div>
          <form onSubmit={(e) => runBulk(e, e.nativeEvent.submitter?.value || 'update')}>
            <Field label="구글시트 URL 또는 ID"><input name="fileId" placeholder="https://docs.google.com/spreadsheets/…" /></Field>
            <div className="button-row"><button className="button warning" value="update">일괄 수정</button><button className="button soft" value="register">일괄 등록</button></div>
          </form>
        </section>
        <section className="card">
          <div className="card-header"><h3>엑셀 다운로드</h3><button type="button" className="text-button" onClick={() => setExportOpen((v) => !v)}>{exportOpen ? '접기' : '항목 선택'}</button></div>
          {exportOpen && <form onSubmit={exportExcel}><div className="header-checks">{headers.map((h) => <label key={h}><input type="checkbox" name="headers" value={h} />{h}</label>)}</div><button className="button primary block">파일 만들기</button></form>}
        </section>
      </aside>
      {detail && <RequestDetail item={detail} onClose={() => setDetail(null)} />}
      {confirm && <ConfirmDialog title={confirm.decision === 'APPROVE' ? '요청 승인' : '요청 반려'} message={`${confirm.item.name}님의 ${REQUEST_LABELS[confirm.item.type] || confirm.item.type} 요청을 ${confirm.decision === 'APPROVE' ? '승인' : '반려'}할까요?`} confirmLabel={confirm.decision === 'APPROVE' ? '승인' : '반려'} danger={confirm.decision !== 'APPROVE'} onConfirm={processRequest} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

function RequestCard({ item, onDetail, onDecision }) {
  const tones = { NEW: 'success', TRANSFER: 'info', UPDATE: 'warning', WITHDRAW: 'danger' };
  const labels = { NEW: '신규', TRANSFER: '이동', UPDATE: '수정', WITHDRAW: '탈퇴' };
  let summary = item.reason || '';
  if (item.type === 'NEW') summary = `희망 부서 ${item.target || '-'} · 나이 ${item.age || '-'}세`;
  if (item.type === 'TRANSFER') summary = `${item.current || '소속미정'} → ${item.target || '-'}`;
  if (item.type !== 'NEW' && item.type !== 'TRANSFER') summary = `회원번호 ${item.member_id} · ${item.current || '소속미정'} · ${item.rank || '-'}`;
  return (
    <article className="request-card">
      <div className="request-top"><StatusBadge tone={tones[item.type]}>{labels[item.type] || item.type}</StatusBadge><strong>{item.name}</strong><time>{item.date}</time></div>
      <div className="request-summary">{summary}</div>
      {item.type === 'UPDATE' && <div className="change-list">{(item.changes || []).map((change, index) => <div className="change-line" key={index}><strong>{change.label}</strong><span>{change.before} → {change.after}</span></div>)}</div>}
      <div className="button-row end">
        {(item.type === 'NEW' || item.photo_id || item.form_file_id) && <button type="button" className="button ghost compact" onClick={onDetail}>상세 보기</button>}
        <button type="button" className="button danger compact" onClick={() => onDecision('REJECT')}>반려</button>
        <button type="button" className="button primary compact" onClick={() => onDecision('APPROVE')}>승인</button>
      </div>
    </article>
  );
}

function RequestDetail({ item, onClose }) {
  let payload = {};
  try { payload = JSON.parse(item.payload || '{}'); } catch (_) { /* ignore */ }
  const labels = {
    target_name: '성명', phone: '전화번호', birth: '생년월일', lunar_solar: '음/양', gender: '성별',
    address: '주소', job: '직업', company: '직장명', birth_place: '출생지', dharma_name: '법명',
    motive: '입회동기', referrer: '소개자', relation: '관계', target_dept_id: '희망부서',
  };
  return (
    <Modal title="신청 상세 정보" onClose={onClose}>
      {item.photo_id && <img className="detail-photo" src={`https://drive.google.com/thumbnail?id=${item.photo_id}&sz=w240`} alt="신청 사진" />}
      {item.form_file_id && <a className="button soft block" href={`https://drive.google.com/file/d/${item.form_file_id}/view`} target="_blank" rel="noreferrer">입회원서 보기</a>}
      <table className="detail-table"><tbody>{Object.entries(labels).map(([key,label]) => { let value = payload[key]; if (key === 'target_dept_id' && item.target) value = item.target; return value ? <tr key={key}><th>{label}</th><td>{String(value)}</td></tr> : null; })}</tbody></table>
    </Modal>
  );
}
