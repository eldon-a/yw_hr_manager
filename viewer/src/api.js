const API_URL = (import.meta.env.VITE_API_URL || '').trim();

/** 조회 화면에 표시하는 5개 항목. 응답의 나머지 개인정보는 여기서 버린다. */
function toViewerRow(member) {
  return {
    photo: String(member.photo || ''),
    name: String(member.name || ''),
    member_id: String(member.member_id || ''),
    dept_name: String(member.dept_name || ''),
    rank: String(member.rank || ''),
  };
}

class ApiError extends Error {
  constructor(message, code = 'api_error') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * 기존 회원관리 Apps Script의 getMemberCardsData를 그대로 호출한다.
 * Content-Type을 지정하지 않아 text/plain으로 전송되므로 CORS preflight가 없다.
 */
async function callApi(action, params = {}, timeoutMs = 30000) {
  if (!API_URL) {
    throw new ApiError('API 주소가 설정되지 않았습니다. viewer/.env.local의 VITE_API_URL을 확인해 주세요.', 'missing_url');
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      signal: controller?.signal,
      body: JSON.stringify({ action, ...params }),
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

/** 이름 정확 일치 조회. 동명이인이 있으면 여러 명이 반환된다. */
export async function searchByName(name) {
  const list = await callApi('getMemberCardsData', { mode: 'name', keyword: name, sortBy: 'member_id' }, 60000);
  return (Array.isArray(list) ? list : []).map(toViewerRow);
}

/** Drive 공유 URL을 썸네일 URL로 바꾼다. */
export function driveThumbnail(url, size = 240) {
  if (!url) return '';
  const text = String(url);
  const match = text.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${size}`;
  return /^https?:\/\//i.test(text) ? text : '';
}
