# JJY Links — Firebase + GitHub Pages URL Shortener

순수 HTML/CSS/Vanilla JS와 Firebase Authentication, Firebase Realtime Database를 사용하는 커스텀 링크 쇼터 예제입니다.

## 파일

- `index.html`: 로그인 / 링크 생성 / 링크 목록 UI
- `styles.css`: 반응형 스타일
- `app.js`: Firebase Auth, 링크 관리(soft delete/복구), 설문 응답 저장, 리다이렉트, 접속 로그
- `404.html`: GitHub Pages 직접 경로 요청 처리
- `firebase-rules.json`: Realtime Database 보안 규칙 샘플
- `CNAME`: `link.jjy0205.site` 커스텀 도메인 설정 파일

## 1. Firebase 프로젝트 설정

1. Firebase Console에서 프로젝트를 만듭니다.
2. **Authentication → Sign-in method**에서 이메일/비밀번호 provider를 켭니다.
3. **Authentication → Users**에서 사용자 계정을 관리자 권한으로 직접 추가합니다. 이 프로젝트 UI에는 회원가입 폼이 없습니다.
4. **Authentication → Settings → User actions**에서 계정 생성 및 삭제를 사용자에게 허용하지 않도록 설정합니다(콘솔 UI의 문구는 변경될 수 있습니다). 이 설정이 UI 제거보다 강력한 서버 측 차단입니다.
5. **Realtime Database**를 생성하고 데이터베이스 URL을 복사합니다.
6. **Project settings → Your apps → Web app**에서 앱 설정을 확인해 `app.js`의 `firebaseConfig`를 교체합니다. `databaseURL`은 콘솔에 표시되는 실제 값을 그대로 사용합니다.
7. Firebase Authentication의 Authorized domains에 `link.jjy0205.site`를 추가합니다.
8. Firebase Console → Realtime Database → Rules에서 `firebase-rules.json` 내용을 붙여넣고 게시합니다.

## 2. 관리자 계정 지정

관리자 계정을 Authentication에 만든 다음 Realtime Database 데이터 탭에서 다음 값을 직접 추가합니다.

```json
{
  "roles": {
    "ADMIN_USER_UID_HERE": "admin"
  }
}
```

`ADMIN_USER_UID_HERE`는 Authentication → Users에서 해당 사용자의 UID로 바꿉니다. `roles`는 이 예제의 Security Rules에서 클라이언트 쓰기를 금지하므로, 관리자 지정/해제는 Firebase Console 등 신뢰할 수 있는 관리자 경로에서만 수행합니다.

## 3. GitHub Pages 배포 및 커스텀 도메인

1. 이 폴더의 파일들을 GitHub 저장소 루트에 올립니다.
2. 저장소 Settings → Pages에서 배포 브랜치와 루트 폴더를 선택합니다.
3. Custom domain에 `link.jjy0205.site`를 입력하고 DNS 업체에서 GitHub Pages가 안내하는 CNAME 레코드를 설정합니다.
4. 커스텀 도메인의 DNS 설정이 완료되면 저장소 루트에 포함된 `CNAME` 파일이 `link.jjy0205.site`인지 확인합니다.
5. HTTPS 적용 후 `https://link.jjy0205.site/`에서 로그인하고 `https://link.jjy0205.site/my-link` 형태로 테스트합니다.

GitHub Pages는 서버 리라이트를 직접 설정할 수 없으므로 `/abc` 직접 접속 시 `404.html`이 원래 경로를 query parameter에 넣어 루트로 보내고, `app.js`가 경로를 복원해 Firebase에서 원본 URL을 조회합니다. 따라서 주소창은 잠시 루트 query를 거칠 수 있으나 스크립트가 실행되면 원래 경로로 복원됩니다.

## 4. 데이터 구조

```json
{
  "links": {
    "my-link": {
      "originalUrl": "https://example.com/page",
      "creatorUid": "firebase-auth-uid",
      "createdAt": 1790000000000,
      "logs": {
        "-generatedLogId": {
          "timestamp": 1790000000000,
          "ip": "203.0.113.10",
          "userAgent": "Mozilla/5.0 ..."
        }
      }
    }
  },
  "roles": {
    "firebase-admin-uid": "admin"
  }
}
```

## 5. 중요한 보안/운영 사항

- Firebase Web config는 브라우저에 노출되는 값이며 비밀 키가 아닙니다. 실질적인 데이터 보호는 Realtime Database Security Rules에 의존합니다.
- 링크 `originalUrl` 노드만 공개 읽기입니다. 방문 로그는 공개 읽기로 열지 않습니다.
- 로그 작성은 비로그인 방문자의 리다이렉트를 위해 공개로 허용됩니다. 공개 엔드포인트라 악의적 요청이 누적될 수 있으므로 실제 서비스에서는 Firebase App Check, 모니터링/쿼터, 가능하다면 서버 측 로그 수집과 속도 제한을 추가하세요.
- IP는 외부 `api.ipify.org`에서 브라우저가 조회합니다. 차단되거나 실패하면 `unavailable`로 기록되고, 브라우저에서 수집한 IP/User-Agent는 신뢰 가능한 보안 증거가 아닙니다.
- 링크 생성 시 `createdAt`은 사용자 브라우저 시각을 사용하므로 조작될 수 있습니다. 감사/과금 등 신뢰도가 필요한 시간은 서버에서 기록해야 합니다.
- 링크 삭제는 soft delete로 처리됩니다. 일반 사용자는 삭제된 링크를 목록에서 볼 수 없고, 관리자는 삭제된 링크를 확인하고 복구할 수 있습니다. 복구 후에는 링크가 다시 작동합니다.
- 접속 로그에 IP와 User-Agent를 저장하므로 실제 공개 서비스 전에 개인정보 고지/보관 기간/삭제 정책을 마련하세요.

## 로그인 문제 해결

로그인 화면이 그대로 남거나 로그인 후 대시보드가 나타나지 않으면 다음 항목을 확인하세요.

1. Firebase Console → Authentication → Sign-in method에서 **이메일/비밀번호** 제공업체가 활성화되어 있어야 합니다.
2. Authentication → Settings → Authorized domains에 실제로 접속하는 도메인(예: `link.jjy0205.site`)이 등록되어 있어야 합니다.
3. Realtime Database에 `roles/{사용자 UID}`가 없어도 일반 사용자로 로그인할 수 있어야 합니다. 이를 위해 Rules가 로그인한 사용자가 자신의 `roles/{uid}` 경로를 읽을 수 있도록 허용해야 합니다.
4. 브라우저 개발자 도구의 Console과 Network에서 `firebase-auth` 요청 오류를 확인하세요. `auth/unauthorized-domain`은 승인 도메인 문제이고, `PERMISSION_DENIED`는 Realtime Database Rules 또는 데이터 경로 문제입니다.
5. 로그인 성공 이후의 IP/User-Agent 로그는 부가 기능입니다. 로그 기록이 실패하더라도 로그인 화면 전환은 차단하지 않도록 구현되어 있습니다.

참고: 현재 `index.html`에는 별도의 팝업 `<dialog>` 모달이 아니라 페이지 내 로그인 패널이 있습니다. 실제 팝업으로 열고 닫는 동작이 필요하다면 HTML에 모달을 여는 트리거와 닫기 동작이 별도로 있어야 합니다.

## 6. 간단한 테스트

1. 일반 사용자 A/B를 Firebase Authentication에서 생성합니다.
2. A로 로그인해 `my-link`를 만들고 목록에만 보이는지 확인합니다.
3. B로 로그인해 A 링크가 보이지 않는지 확인합니다.
4. `roles/{A_UID}` 또는 `roles/{B_UID}`를 `admin`으로 설정한 계정으로 로그인해 전체 링크와 삭제된 링크가 보이고 복구할 수 있는지 확인합니다.
5. 로그아웃한 브라우저에서 `https://link.jjy0205.site/my-link`를 열어 원본 URL로 이동하는지, Realtime Database에 `logs`가 쌓이는지 확인합니다.
6. soft delete한 slug에 접속해 이동이 차단되는지 확인합니다.
7. 설문 기능을 켠 링크를 로그아웃 상태로 열고 질문에 답변 및 동의한 뒤 원본 사이트로 이동하며 `surveyResponses/{customPath}`에 응답이 저장되는지 확인합니다.
8. 링크 생성자와 관리자가 설문 응답 표를 볼 수 있고, 다른 일반 사용자는 볼 수 없는지 확인합니다.
9. 일반 사용자에게는 int만 표시되고 숫자 외 입력이 거부되는지, 관리자에게는 int/char가 모두 표시되는지 확인합니다.
10. 생성 후 설문 옵션 변경 메뉴가 관리자에게만 표시되는지 확인합니다.

## 추가된 기능 (JJY Links 업데이트)

- 로그인 성공 시 `loginLogs/{uid}/{logId}`에 시각, 이메일, UID, IP(브라우저에서 조회), User-Agent를 기록합니다. 본인과 관리자는 해당 기록을 읽을 수 있도록 규칙을 구성했습니다. 현재 관리 화면에는 로그인 로그 조회 UI가 없으며, Firebase Console의 Realtime Database에서 확인할 수 있습니다.
- 링크 생성 시 만료 시각을 선택할 수 있고, 링크 목록에서 `만료일 변경`으로 수정/해제할 수 있습니다. 만료된 링크는 원본 주소로 이동하지 않습니다. 기존 데이터에 `expiresAt`이 없으면 만료되지 않는 것으로 처리합니다.
- 링크 목록의 `QR 코드` 버튼은 단축 URL의 QR 이미지를 외부 QR 서비스에서 엽니다. 따라서 단축 URL이 해당 서비스에 전달됩니다.
- 링크 생성 시 `접속 전 설문조사 받기`를 선택하고 원하는 질문을 추가할 수 있습니다. 일반 사용자에게는 숫자형(int, 숫자만 입력)만 제공하고, 관리자는 숫자형(int)과 문자형(char)을 모두 설정할 수 있습니다. 응답은 `surveyResponses/{customPath}/{responseId}`에 저장됩니다.
- 링크 관리 목록의 `설문 응답 보기`에서 링크 생성자와 관리자만 응답자별 제출 시각 및 답변을 표로 볼 수 있습니다. `설문 옵션 변경 (관리자)`은 관리자에게만 표시되며, 생성 이후 설문 활성화/질문/응답 형식 변경은 관리자만 할 수 있습니다.
- 설문 설정은 `surveyConfigs/{customPath}`에 별도로 저장합니다. 방문자는 설문 질문을 읽고 응답을 제출할 수 있지만, 다른 사람의 응답을 읽을 수 없습니다. 학번 등 개인정보를 수집할 때는 목적·보관 기간·삭제 방법을 명확히 고지하고 필요한 동의를 받으세요.
- 설문 응답은 링크가 삭제되거나 만료되었을 때 저장되지 않도록 RTDB 규칙에서 검사합니다. 학번과 이름은 개인정보이므로 수집 목적, 보관 기간, 삭제 방법을 사용자에게 명확히 고지하고 필요한 동의를 받으세요.
- 유효한 기존 단축 링크의 접속 로그는 `404.html`이 아니라 `index.html`이 로드하는 `app.js`의 `resolveShortLink()` → `recordAccess()`에서 기록됩니다. 존재하지 않는 경로, 잘못된 경로, 만료된 링크는 현재 방문 로그를 저장하지 않습니다.

### 적용 방법

1. 저장소의 `index.html`, `app.js`, `styles.css`, `404.html`을 이 폴더의 파일로 교체합니다.
2. Firebase Console → Realtime Database → Rules에 `firebase-rules.json`을 붙여넣고 게시합니다.
3. 테스트 계정으로 로그인하여 로그인 로그가 `loginLogs/{uid}`에 추가되는지 확인합니다.
4. 만료 시각을 설정한 링크가 해당 시각 이후 이동을 차단하는지 확인합니다.
5. 일반 사용자 계정으로 다른 사용자의 링크 만료일을 바꿀 수 없는지 확인합니다.
6. 일반 사용자는 삭제된 링크를 목록에서 볼 수 없고, 관리자만 복구 버튼을 볼 수 있는지 확인합니다.
7. 설문을 활성화한 링크에서 응답 저장 후 이동되는지, 비활성화한 링크에서는 설문 없이 바로 이동되는지 확인합니다.

### 운영상 주의

IP와 User-Agent는 클라이언트에서 수집하므로 위조될 수 있으며, 브라우저 IP 조회 서비스가 실패하면 `unavailable`로 저장됩니다. 신뢰할 수 있는 감사 로그, IP 제한, 속도 제한이 필요하면 서버 측(예: Cloud Functions)에서 수집해야 합니다. IP/User-Agent 보관에 대한 개인정보 고지와 보관·삭제 정책도 마련하세요. Realtime Database Rules는 실제 서비스 데이터로 별도 테스트한 뒤 배포하세요.

### 설문 옵션 권한 참고
- Firebase Rules도 관리자만 `char` 질문을 저장할 수 있도록 제한합니다. 화면에서만 숨기는 방식이 아닙니다.
- 기존 버전에서 링크 레코드 안에 `surveyEnabled`만 저장했던 링크는 새 `surveyConfigs/{customPath}` 구조로 설문 설정을 한 번 다시 구성해야 할 수 있습니다.
- 업데이트 후 Firebase Console의 Realtime Database → Rules에 포함된 `firebase-rules.json` 전체를 게시해야 새 설문 응답 조회 권한과 관리자 전용 설정 변경 권한이 적용됩니다.


## 설문 응답 표시 문제 해결 및 UI 업데이트

- 링크 목록은 화면 폭에 맞춰 가로 카드 그리드로 배치됩니다. 데스크톱에서는 가능한 경우 두 개 이상의 열을 사용하고, 좁은 화면에서는 한 열로 전환합니다.
- `설문 응답 보기` 패널은 링크 카드 전체 폭을 차지하며, 응답 표는 열이 많을 때 좌우 스크롤을 지원합니다.
- 응답 조회 오류를 모두 Firebase Rules 오류로 오해하지 않도록, 실제 오류 코드와 권한 거부 여부를 구분해 표시합니다.
- 설문 결과 읽기 권한은 로그인한 링크 생성자 또는 `roles/{uid}` 값이 `admin`인 계정에만 부여해야 합니다. `firebase-rules.json`의 `surveyResponses/$customPath/.read` 조건을 사용 중인 실제 Realtime Database에 게시하세요.
- 코드가 화면에서 링크 생성자/관리자라고 판단하지만 `PERMISSION_DENIED`가 계속된다면 `app.js`의 `databaseURL`과 규칙을 게시한 Firebase Realtime Database 인스턴스가 동일한지 확인하세요. 또한 `links/{customPath}/creatorUid`와 로그인 UID가 일치하는지 확인하세요.


## 설문 응답과 접속 로그 연결

- 새 설문 응답은 `surveyResponses/{customPath}/{responseId}`에 `ip`, `userAgent`, `accessLogId`를 함께 저장합니다. 응답 표에도 접속 IP와 연결 로그 ID가 같은 행에 표시됩니다.
- 같은 제출의 접속 로그는 `links/{customPath}/logs/{accessLogId}`에 저장되며, 로그의 `responseId`가 원래 설문 응답 ID를 가리킵니다. 응답과 접속 로그는 한 번의 Realtime Database 다중 경로 업데이트로 저장되어 둘 중 하나만 저장되는 상황을 방지합니다.
- 이전에 저장된 응답에는 IP 또는 연결 ID가 없을 수 있습니다. 해당 응답의 IP는 정확하게 소급 연결할 수 없으며, UI에서 미기록으로 표시합니다.
- IP와 User-Agent는 브라우저가 외부 IP 조회 서비스에서 얻은 값이므로 조회 실패 시 `unavailable`이 저장될 수 있고, 클라이언트 값은 위조될 수 있습니다. IP/User-Agent 수집 사실과 보관 정책을 이용자에게 명확히 안내하세요.


## IP 주소 개인정보 보호 업데이트

- 설문 응답 본문(`surveyResponses`)에는 IP 주소나 User-Agent를 저장하지 않습니다. 응답에는 `accessLogId`만 남깁니다.
- 접속 로그와 IP/User-Agent는 `privateAccessLogs/{customPath}/{logId}`에 별도 저장하며, 이 경로는 `roles/{uid} === "admin"`인 계정만 읽을 수 있습니다.
- 일반 사용자는 설문 결과에서 연결 로그 ID와 답변만 볼 수 있고, IP 주소 및 브라우저 정보는 표시되지 않습니다.
- 기존 버전이 `links/{customPath}/logs`에 저장한 로그는 과거 데이터입니다. Realtime Database Rules의 상위 `.read` 권한은 하위 노드에 상속되므로, 해당 기존 `logs` 노드를 Firebase Console에서 삭제하거나 관리자만 접근 가능한 별도 경로로 이전해야 과거 IP도 노출되지 않습니다.
- 새 규칙을 게시한 후에는 `links/{customPath}/logs` 아래의 이전 로그를 정리하세요. 새 접속 로그는 `privateAccessLogs`에 저장됩니다.
