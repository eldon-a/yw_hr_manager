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
├── viewer/                  # 조회 전용 별도 앱
│   ├── src/
│   │   ├── App.jsx          # 이름 검색 + 결과 목록
│   │   ├── api.js           # getMemberCardsData 호출, 5개 항목만 추출
│   │   └── styles.css
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
- 관리자 기능은 로그인 시 발급되는 6시간짜리 서명 토큰(HMAC-SHA256)으로 보호합니다.
- 읽기 전용 API는 Apps Script가 느릴 때 자동으로 2번까지 다시 시도합니다.
- 관리자 로그인 응답에 회원 헤더를 함께 담아 왕복 1회를 줄였습니다.
- 승인 대기 목록은 대시보드를 먼저 띄운 뒤 목록 영역에서만 로딩을 표시합니다.
- 승인 대기 회원 조회는 회원번호 열로 대상 행을 먼저 찾아 그 행만 읽습니다.
- 신청 payload는 행마다 한 번만 파싱합니다(기존에는 최대 3번).
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

## 3. 회원조회 전용 앱 (`viewer/`)

`web/`과 완전히 분리된 조회 전용 앱입니다. 이름으로 검색해 **사진·이름·회원번호·소속·법계**만 표시합니다.

```bash
cd viewer
cp .env.example .env.local
# VITE_API_URL에 web/.env.local과 동일한 Apps Script /exec URL 입력
npm install
npm run dev      # http://localhost:5175
npm run build    # viewer/dist/ 를 정적 호스팅에 배포
```

- **Apps Script 수정·재배포가 필요 없습니다.** 이미 배포된 `getMemberCardsData`
  (`mode: 'name'`)를 그대로 호출합니다. 이 액션은 관리자 세션을 요구하지 않습니다.
- 검색은 **이름 정확 일치**입니다(기존 회원카드 화면과 동일). 동명이인은 모두 표시됩니다.
- 응답에는 주소·전화번호 등이 함께 오지만 `viewer/src/api.js`의 `toViewerRow()`에서
  5개 항목만 남기고 즉시 버리므로 화면·상태에는 남지 않습니다.
  전송량까지 줄이려면 Apps Script에 조회 전용 액션을 추가해야 합니다.
- 별도 로그인이 없으므로 URL을 아는 사람은 누구나 조회할 수 있습니다.
  공개 범위는 호스팅 단계(사내망, 비공개 URL, 접근 제어)에서 통제하세요.
- 부분 일치 검색이 필요하면 `Code.gs`의 `getMemberCardsData`에서
  `mode === 'name'` 비교(`normalize(name) !== key`)를 `indexOf` 기반으로 바꾸거나
  조회 전용 액션을 새로 추가하면 됩니다.

## 기존 데이터 호환

시트 이름, 열 이름, Drive 폴더, 회원번호 발급, 승인 처리, 이력 기록, 사진 처리 큐,
부서·법계 현황, 회원카드 PDF 생성 로직은 기존 `Code.gs`와 동일합니다. 따라서 별도 데이터 이전은 필요하지 않습니다.

## 관리자 세션 방식

로그인에 성공하면 Apps Script가 `역할·이메일·이름·만료시각`을 담아 HMAC-SHA256으로 서명한
토큰을 발급합니다. 서버는 이 토큰을 **저장하지 않고 서명만 검증**하므로, 캐시가 비워지거나
Apps Script 인스턴스가 바뀌어도 6시간 동안 세션이 유지됩니다.

- 서명키는 최초 1회 `ScriptProperties`의 `HRM_API_SESSION_SECRET_V1`에 만들어져 계속 재사용됩니다.
- 이 값을 지우면 발급된 모든 토큰이 즉시 무효가 됩니다(전체 강제 로그아웃 용도로 사용 가능).
- 토큰은 브라우저 탭의 `sessionStorage`에만 보관되고 탭을 닫으면 사라집니다.
  새로고침(F5)해도 남은 유효시간 동안은 다시 로그인하지 않습니다.
- 만료되면 프런트가 자동으로 로그인 화면으로 돌려보냅니다.

## 문제 해결

**"로그인 시간이 만료되었습니다"가 로그인 직후에 반복될 때**

과거에는 세션을 `CacheService`에 저장했는데, 이 캐시는 용량이 차면 만료 전이라도 항목을
지웁니다. 같은 스크립트가 승인 대기 목록(최대 100KB)·검색 결과·회원카드 PDF 작업을 함께
캐시하므로 세션이 수 분 만에 밀려나 사라졌습니다. 위의 서명 토큰 방식으로 바꿔 해결했습니다.
**`apps-script/Code.gs`를 새 버전으로 다시 배포해야 적용됩니다.**

**화면이 안 열리거나 응답 시간 초과가 뜰 때**

정적 파일(Vercel)은 보통 100ms 안에 응답하므로 대부분 Apps Script 쪽 지연입니다.
콜드 스타트 때 30초를 넘기는 경우가 있어 기본 대기 시간을 45초로 늘리고, 읽기 전용 API는
자동으로 다시 시도하도록 했습니다. 데이터를 바꾸는 요청(가입 신청, 승인/반려, 사진 업로드,
일괄 등록·수정)은 중복 처리를 막기 위해 재시도하지 않습니다.

**관리자 로그인 후 목록이 뜨기까지 오래 걸릴 때**

Apps Script는 아무 일도 하지 않는 호출(`ping`)조차 왕복에 1.5~3초가 듭니다. 즉 처리 시간보다
**호출 횟수**가 체감 속도를 지배합니다. 예전에는 로그인 → 승인 대기 목록 → 회원 헤더로
3번을 오갔는데, 지금은 관리자 로그인 응답에 나머지 둘을 함께 담아 **1번**으로 끝냅니다.

승인 대기 목록 자체는 요청 건수와 payload 크기에 따라 수 초가 걸릴 수 있어 로그인에 합치지
않습니다. 대시보드를 먼저 띄우고 목록 영역에만 로딩 표시를 두므로, 목록을 기다리는 동안에도
다른 기능을 쓸 수 있습니다.

목록이 느린 원인은 **Apps Script 편집기에서 `diagnosePendingRequestsPerformance()`를 실행**해
확인할 수 있습니다. 데이터는 바꾸지 않고 실행 로그에 단계별 소요 시간과 시트 규모,
payload 크기를 출력합니다. 여기서 100KB를 넘는 payload가 잡히면
`compactPendingRequestPayloads()`를 한 번 실행해 과거 요청에 남은 사진·문서 base64를 정리하세요.

아래 명령으로 백엔드 상태를 직접 확인할 수 있습니다.

```bash
curl -sL "https://script.google.com/macros/s/<배포ID>/exec"
# {"ok":true,"result":{"service":"hr-manager-api","status":"ok",...}}
```
