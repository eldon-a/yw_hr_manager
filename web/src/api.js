const API_URL = (import.meta.env.VITE_API_URL || '').trim();
const inflight = new Map();

class ApiError extends Error {
  constructor(message, code = 'api_error') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function cacheRead(key, ttl) {
  try {
    const item = JSON.parse(localStorage.getItem(key) || 'null');
    if (item && Date.now() - item.ts < ttl) return item.value;
  } catch (_) { /* ignore damaged cache */ }
  return null;
}

function cacheWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); } catch (_) { /* quota */ }
}

export async function callApi(action, params = {}, options = {}) {
  if (!API_URL) {
    throw new ApiError('API 주소가 설정되지 않았습니다. web/.env.local의 VITE_API_URL을 확인해 주세요.', 'missing_url');
  }

  const timeoutMs = options.timeoutMs || 30000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    let authToken = '';
    try { authToken = sessionStorage.getItem('hrm.apiToken.v1') || ''; } catch (_) { /* private mode */ }
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      signal: controller?.signal,
      body: JSON.stringify({ action, ...params, ...(authToken ? { authToken } : {}) }),
    });
    if (!response.ok) throw new ApiError(`서버 응답 오류 (HTTP ${response.status})`, 'http_error');
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      throw new ApiError('API가 JSON 대신 다른 문서를 반환했습니다. Apps Script 배포 권한과 URL을 확인해 주세요.', 'invalid_response');
    }
    if (!data.ok) throw new ApiError(data.message || '요청 처리 중 오류가 발생했습니다.', data.error || 'server_error');
    return data.result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') throw new ApiError('응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', 'timeout');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError('인터넷 연결이 끊겼습니다. 연결 후 다시 시도해 주세요.', 'offline');
    }
    throw new ApiError('서버에 연결할 수 없습니다. Apps Script 배포 상태를 확인해 주세요.', 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cachedCall(cacheKey, ttl, action, params = {}) {
  const cached = cacheRead(cacheKey, ttl);
  if (cached !== null) return Promise.resolve(cached);
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const promise = callApi(action, params)
    .then((value) => {
      cacheWrite(cacheKey, value);
      return value;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);
  return promise;
}

export const api = {
  departments: () => cachedCall('hrm.departments.v2', 6 * 60 * 60 * 1000, 'getDepartmentList'),
  memberHeaders: () => cachedCall('hrm.headers.v2', 30 * 60 * 1000, 'getMemberHeaders'),
  memberCardFilters: () => cachedCall('hrm.cardFilters.v2', 15 * 60 * 1000, 'getMemberCardFilterOptions'),
  searchMembers: (keyword) => callApi('searchMembers', { keyword }),
  staffLogin: async (email, password) => {
    try { sessionStorage.removeItem('hrm.apiToken.v1'); } catch (_) { /* private mode */ }
    const result = await callApi('checkAuthAndLoadData', { email, password });
    try { sessionStorage.setItem('hrm.apiToken.v1', result.apiToken || ''); } catch (_) { /* private mode */ }
    return result;
  },
  selfCandidates: (name, memberId, departmentName) => callApi('findSelfMemberCandidates', { name, memberId, departmentName }),
  verifyMember: (name, memberId, departmentName) => callApi('verifyMemberLogin', { name, memberId, departmentName }),
  reconsent: (memberId, type = 'WEB_SELF') => callApi('submitReconsent', { memberId, type }),
  reconsentByToken: (token, version) => callApi('submitReconsentByToken', { token, version }),
  submitRequest: (form) => callApi('submitRequest', { form }, { timeoutMs: 90000 }),
  pendingRequests: () => callApi('getPendingRequests'),
  processRequest: (requestId, decision, adminEmail) => callApi('processAdminAction', { requestId, decision, adminEmail }, { timeoutMs: 60000 }),
  audit: (mode, p1, p2, header) => callApi('getDetailedHistory', { mode, p1, p2, header }),
  bulkUpdate: (fileId, adminEmail) => callApi('runExternalBulkUpdate', { fileId, adminEmail }, { timeoutMs: 120000 }),
  bulkRegister: (fileId, adminEmail) => callApi('runExternalBulkRegister', { fileId, adminEmail }, { timeoutMs: 120000 }),
  exportExcel: (headers) => callApi('exportToExcel', { headers }, { timeoutMs: 120000 }),
  photoSearch: (name) => callApi('searchMembersForPhoto', { name }),
  uploadPhoto: (payload) => callApi('uploadMemberPhotoDirect', payload, { timeoutMs: 120000 }),
  cardData: (mode, keyword, sortBy) => callApi('getMemberCardsData', { mode, keyword, sortBy }, { timeoutMs: 60000 }),
  cardPdfBatch: (payload) => callApi('generateMemberCardsPdfBatch', payload, { timeoutMs: 120000 }),
};

export function clearStaffSession() {
  try { sessionStorage.removeItem('hrm.apiToken.v1'); } catch (_) { /* ignore */ }
}

export function clearReferenceCache() {
  ['hrm.departments.v2', 'hrm.headers.v2', 'hrm.cardFilters.v2'].forEach((key) => {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  });
}
