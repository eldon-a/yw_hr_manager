// 전화번호가 휴대전화 패턴으로 보이면 010-0000-0000 형식으로 맞춘다.
// 앞자리 0이 빠진 값(1059572040)과 국가번호 표기(+82 10-...)도 010-5957-2040 으로 복원한다.
// 휴대전화 패턴이 아니면(일반전화, 복수 번호 등) 공백만 정리해 입력값을 그대로 돌려준다.
// 서버(apps-script/Code.gs)의 formatMobilePhone_ 과 같은 규칙이다.
export function formatMobilePhone(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if (/^82(1[016789]\d{7,8})$/.test(digits)) digits = `0${digits.slice(2)}`;
  if (/^1[016789]\d{7,8}$/.test(digits)) digits = `0${digits}`;
  if (/^01[016789]\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  // 010 은 항상 11자리이므로 10자리(3-3-4) 형식은 011·016·017·018·019 만 인정한다.
  if (/^01[16789]\d{7}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

// 비제어 input 의 onBlur 에 연결해 입력을 마치면 바로 형식을 맞춰 보여 준다.
export function formatPhoneInput(event) {
  const input = event?.target;
  if (!input) return;
  const next = formatMobilePhone(input.value);
  if (next !== input.value) input.value = next;
}
