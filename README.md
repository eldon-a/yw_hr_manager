# 회원관리 시스템 (Vite + React + Google Apps Script API)

기존 `Code.gs`, `index.html`, `membercard.html`, `photo.html`, `reconsent.html`의 기능을
정적 React 프런트엔드와 JSON 전용 Apps Script 백엔드로 분리한 버전입니다.

## 구조

```text
hr_manager_new/
├── apps-script/
│   └── Code.gs              # 기존 시트/Drive 로직 + JSON API
├── web/
│   ├── src/
│   │   ├── App.jsx          # 가벼운 해시 라우팅 + 화면별 코드 분할
│   │   ├── api.js           # fetch API, 타임아웃, 중복호출·로컬 캐시
│   │   ├── file-utils.js    # 사진 검증·대용량 이미지 최적화
│   │   └── pages/
│   │       ├── MembershipApp.jsx
│   │       ├── PhotoUpload.jsx
│   │       ├── MemberCards.jsx
│   │       └── Reconsent.jsx
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
├── Code.gs                  # 기존 GAS 버전(보존)
└── *.html                   # 기존 GAS HTML 버전(보존)
```

## 개선된 부분

- HTML을 매번 Apps Script에서 렌더링하지 않고 정적 번들을 CDN에서 제공합니다.
- 화면별 코드를 나눠 첫 화면에서 필요하지 않은 사진·카드 코드는 나중에 받습니다.
- 부서 목록은 6시간, 회원 헤더는 30분, 카드 필터는 15분 동안 브라우저에 캐시합니다.
- 동일 기준정보 요청은 한 번만 보내고 여러 화면이 그 결과를 함께 사용합니다.
- 기존 서버 검색 캐시와 사진 처리 큐를 그대로 사용합니다.
- 2MB 초과 또는 고해상도 회원사진은 브라우저에서 최대 1800×2700px로 최적화해 전송합니다.
- 관리자 기능은 로그인 시 발급되는 6시간짜리 API 세션으로 보호합니다.
- 승인 대기 목록은 연속 행·회원 정보를 일괄 읽고 30초간 서버 캐시합니다.
- 신청 파일의 base64 본문은 Drive 저장 후 Requests 시트와 목록 응답에서 제거합니다.

## 로그인 동작

- **내 정보 수정**: 성명과 소속 부서는 필수이며 회원번호는 선택입니다. 같은 부서에 동명이인이 있으면 후보를 모두 표시하고 본인을 선택합니다.
- **Cowork 부서담당자**: `yw_insa@tmp.com`은 비밀번호 없이 `부서담당자` 권한으로 로그인합니다. 관리자 승인·이력·엑셀 기능은 사용할 수 없습니다.

## 화면 주소

해시 라우팅을 사용하므로 정적 호스팅의 별도 라우팅 설정이 필요하지 않습니다.

| 화면 | 주소 |
|---|---|
| 회원 가입·수정·관리자 | `#/` |
| 회원 사진·정보 수정 | `#/photo` |
| 회원카드 인쇄·PDF | `#/member-card` |
| 개인정보 재동의 | `#/reconsent?token=회원번호` |

기존 링크 호환을 위해 `?page=photo`, `?page=membercard`, `?page=reconsent&token=...` 형식도 인식합니다.

## 1. Apps Script 백엔드 배포

1. 현재 회원관리 스프레드시트의 **확장 프로그램 → Apps Script**를 엽니다.
2. 기존 운영 코드는 백업한 뒤 [`apps-script/Code.gs`](apps-script/Code.gs) 내용으로 교체합니다.
3. 기존 사진 큐를 사용한다면 `setupPhotoUploadTrigger()`를 한 번 실행해 1분 트리거를 확인합니다.
   과거 대기 신청에 사진·문서가 많다면 `compactPendingRequestPayloads()`도 한 번 실행합니다.
4. **배포 → 새 배포 → 웹 앱**을 선택합니다.
   - 실행 계정: 나
   - 액세스 권한: 운영 정책에 맞게 설정
5. 배포 URL(`https://script.google.com/macros/s/.../exec`)을 복사합니다.
6. 브라우저에서 배포 URL을 열었을 때 `service: hr-manager-api`, `status: ok` JSON이 보이면 정상입니다.

Apps Script 코드를 수정한 뒤에는 반드시 **배포 관리 → 수정 → 새 버전**으로 다시 배포해야 합니다.

## 2. React 프런트 실행

```bash
cd web
cp .env.example .env.local
# .env.local의 VITE_API_URL에 위 Apps Script /exec URL 입력
npm install
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm run preview
```

생성된 `web/dist/`를 Vercel, Netlify, GitHub Pages 또는 사내 정적 서버에 배포하면 됩니다.

## 기존 데이터 호환

시트 이름, 열 이름, Drive 폴더, 회원번호 발급, 승인 처리, 이력 기록, 사진 처리 큐,
부서·법계 현황, 회원카드 PDF 생성 로직은 기존 `Code.gs`와 동일합니다. 따라서 별도 데이터 이전은 필요하지 않습니다.

관리자 세션은 Apps Script `CacheService`에 6시간 보관됩니다. 만료 안내가 나오면 다시 로그인하면 됩니다.
