# JJY Links — Firebase + GitHub Pages URL Shortener

순수 HTML/CSS/Vanilla JS와 Firebase Authentication, Firebase Realtime Database를 사용하는 커스텀 링크 쇼터 예제입니다.

## 파일

- `index.html`: 로그인 / 링크 생성 / 링크 목록 UI
- `styles.css`: 반응형 스타일
- `app.js`: Firebase Auth, 링크 CRUD, 리다이렉트, 접속 로그
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
- 현재 규칙에서는 사용자가 자신의 링크 노드를 삭제할 수 있으므로 해당 링크의 로그도 함께 지워집니다. 변조 방지가 필요한 감사 로그라면 로그를 별도 최상위 경로로 분리하고 서버에서만 쓰도록 설계해야 합니다.
- 접속 로그에 IP와 User-Agent를 저장하므로 실제 공개 서비스 전에 개인정보 고지/보관 기간/삭제 정책을 마련하세요.

## 6. 간단한 테스트

1. 일반 사용자 A/B를 Firebase Authentication에서 생성합니다.
2. A로 로그인해 `my-link`를 만들고 목록에만 보이는지 확인합니다.
3. B로 로그인해 A 링크가 보이지 않는지 확인합니다.
4. `roles/{A_UID}` 또는 `roles/{B_UID}`를 `admin`으로 설정한 계정으로 로그인해 전체 링크가 보이고 삭제가 가능한지 확인합니다.
5. 로그아웃한 브라우저에서 `https://link.jjy0205.site/my-link`를 열어 원본 URL로 이동하는지, Realtime Database에 `logs`가 쌓이는지 확인합니다.
6. 사용하지 않는 slug나 삭제한 slug에 접속해 “링크를 찾을 수 없습니다”가 표시되는지 확인합니다.
