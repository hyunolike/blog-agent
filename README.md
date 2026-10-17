<div align="center">

<img src="docs/images/banner.svg" alt="~/ask hyunolike — 블로그 글을 근거로 답하는 AI 채팅" width="820">

<br>
<br>

**[hyunolike 기술 블로그](https://hyunolike.tistory.com)의 글을 근거로 답하고, 어느 글에서 가져왔는지 함께 알려주는 AI 채팅**

![Next.js](https://img.shields.io/badge/Next.js_16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vercel AI SDK](https://img.shields.io/badge/AI_SDK_7-000000?logo=vercel&logoColor=white)
![NVIDIA](https://img.shields.io/badge/NVIDIA_API-76B900?logo=nvidia&logoColor=white)
![Upstash](https://img.shields.io/badge/Upstash_Redis-00E9A3?logo=upstash&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?logo=githubactions&logoColor=white)

</div>

> [블로그에서 사용하기](https://hyunolike.tistory.com/) · [채팅 화면 바로 열기](https://blog-agent-ruddy.vercel.app/embed)

<br>

## 소개 영상 🎬

https://github.com/user-attachments/assets/a620696a-b0b8-47b7-994d-a1af05d0aa76

20초 소개 영상입니다. 영상 속 답변은 화면 시연용입니다. 원본은 [`docs/video/brag.mp4`](docs/video/brag.mp4)에 있습니다.

<br>

## 프로젝트 소개 📝

기술 블로그에 글이 70개를 넘어가면서, 처음 온 사람이 원하는 글을 찾기가 어려워졌습니다. 채용 담당자는 "장애를 어떻게 대응했는지"를 알고 싶어 하고, 검색으로 들어온 방문자는 "systemd timer를 왜 썼는지"만 궁금합니다. 두 사람 모두 글 목록을 처음부터 훑어야 했습니다.

`blog-agent`는 블로그 오른쪽 아래에 채팅 버튼을 하나 답니다. 질문을 받으면 블로그 글에서 관련된 부분을 찾아 답변의 근거로 제공하고, 인용한 글의 링크를 함께 보여줍니다. 모델에는 글에 없는 사실을 만들지 않고, 근거가 부족하면 그 한계를 밝히도록 지시합니다. AI 답변이므로 원문과 함께 확인해야 합니다.

<br>

## 핵심 기능 ✨

### 1. 블로그 글을 근거로 답합니다

답변의 `[1]` 같은 출처 번호를 누르면 해당 글로 이동합니다. 실제 인용한 글만 답변 아래 출처 카드로 보여줍니다.

### 2. 보고 있는 글을 알고 답합니다

글 페이지에서 채팅을 열면 "이 글 3줄 요약해줘" 같은 질문을 바로 할 수 있습니다. 인덱스에 있는 글이면 그 글의 요약을 첫 번째 근거로 넣고, 본문 조각도 함께 제공합니다.

### 3. 기술 용어를 정확히 찾습니다

벡터 검색과 키워드 검색을 함께 씁니다. `RequiresMountsFor`나 `ORA-28040`처럼 정확한 철자가 중요한 용어는 키워드 검색으로 보완합니다. 임베딩 호출이 실패해도 키워드 검색으로 계속 진행합니다.

### 4. 모델이 늦거나 실패하면 다른 모델이 이어받습니다

기본 모델이 답변을 시작하기 전에 실패하거나 지연되면 두 번째 모델로 넘깁니다. 두 모델이 모두 실패해도 검색된 관련 글 링크는 보여줍니다.

### 5. 스크립트 한 줄로 붙입니다

티스토리 스킨에 `<script>` 한 줄만 넣으면 됩니다. 채팅 화면은 iframe 안에서 돌아가서 블로그 스킨의 CSS와 서로 영향을 주지 않습니다.

<br>

## 화면 🖥️

실제 모델을 연결해 로컬에서 확인한 화면입니다.

| PC: 질문에 출처와 함께 답한 화면 | 모바일: 글 페이지에서 "이 글 3줄 요약해줘" |
| :---: | :---: |
| <img src="docs/images/widget-desktop.png" alt="PC에서 채팅 패널이 열린 화면" width="560"> | <img src="docs/images/embed-mobile.png" alt="모바일에서 글 페이지 기준으로 열린 채팅 화면" width="240"> |

<br>

## 기술 스택 💡

| 영역 | 기술 |
| --- | --- |
| 앱 | Next.js 16 (App Router), React 19, TypeScript 6 |
| AI | Vercel AI SDK 7, NVIDIA API 카탈로그 (답변 모델과 임베딩) |
| 검색 | 직접 구현한 BM25와 벡터 검색, RRF 결합 (별도 DB 없이 `data/index.json`) |
| 수집 | cheerio, turndown, GitHub Actions |
| 요청 제한 | Upstash Redis |
| 테스트 | Vitest |
| 배포 | Vercel |

<br>

## 구조 🏛

<img src="docs/images/architecture-3d.png" alt="티스토리 위젯이 Vercel 채팅 API를 호출하고, API가 앱에 포함된 검색 인덱스와 Upstash 요청 제한, NVIDIA 모델을 사용하는 구조. GitHub Actions가 블로그 글을 수집해 인덱스를 커밋하면 Vercel이 재배포한다." width="1000">

위쪽은 질문과 답변, 아래쪽은 검색 인덱스를 갱신하는 흐름입니다. 티스토리는 별도로 운영되며, 채팅 화면과 API는 Vercel에 배포됩니다.

- **Vercel:** `widget.js`, `/embed`, `/api/chat`을 제공합니다. 배포에 포함된 `data/index.json`을 읽어 메모리에서 BM25와 벡터 검색을 결합합니다.
- **NVIDIA API:** 질문과 글 조각의 임베딩을 만들고, 검색된 근거로 답변을 생성합니다.
- **Upstash Redis:** IP별 요청 수와 전체 일일 요청 수, 기본 모델의 일시 제한 상태를 공유합니다. 블로그 본문과 대화 기록을 저장하는 용도는 아닙니다.
- **GitHub Actions → develop → Vercel:** 바뀐 글을 수집해 인덱스를 갱신하고, 실제 변경이 있을 때 커밋과 재배포가 이어집니다.

대화 기록은 브라우저의 `sessionStorage`에 보관합니다. 서버에 대화 이력을 영구 저장하지 않으며, 답변 생성 시에는 최근 메시지를 모델 API로 보냅니다.

수집이 실패해도 채팅은 마지막으로 배포된 인덱스로 계속 동작합니다.

### 저장소 구조

```text
.
├── ingest/            # sitemap 읽기, 본문 추출, 조각 나누기, 인덱스 빌드
├── lib/               # 검색, 프롬프트, 모델 전환, 요청 제한
├── app/
│   ├── api/chat/      # 스트리밍 채팅 API
│   └── embed/         # iframe에 들어가는 채팅 화면
├── public/widget.js   # 티스토리 스킨이 불러가는 위젯
├── data/index.json    # 수집한 글과 검색용 임베딩
├── .github/workflows/ingest.yml  # 예약 수집과 인덱스 커밋
├── eval/              # 검색 품질과 답변 품질 평가
├── tests/             # 단위 테스트와 실제 글 HTML 테스트 데이터
└── docs/              # 구조도, 화면, 영상, 설계 문서
```

<br>

## 이렇게 만든 이유 🤔

#### 1. 벡터 DB를 두지 않았습니다

블로그 규모에서는 파일 하나를 읽어 메모리에서 비교하는 구성이 충분하다고 판단했습니다. 별도 검색 DB 없이 수집 결과를 배포에 포함하므로, 인덱스가 바뀌면 재배포가 필요합니다.

#### 2. 키워드 검색을 직접 만들었습니다

한국어 기술 글은 한글 문장 안에 영문 용어가 섞여 있습니다. 한글은 두 글자씩 끊어 색인하고 영문 용어는 단어 그대로 색인합니다. 형태소 분석기를 두지 않고도 기술 용어를 검색하고, 의미 검색과 함께 순위를 합칠 수 있습니다.

#### 3. 모델 전환은 첫 글자가 나가기 전에만 합니다

답변이 절반쯤 나오다가 다른 모델의 답으로 바뀌면 읽는 사람이 더 혼란스럽습니다. 그래서 답이 시작된 뒤에 끊기면 모델을 바꾸지 않고 "다시 시도" 버튼을 보여줍니다.

<br>

## 로컬 실행

Node.js 22 이상이 필요합니다. 저장소에 인덱스가 포함되어 있어, 기존 글로 채팅을 확인할 때는 수집을 다시 실행하지 않아도 됩니다.

```bash
npm ci
cp .env.example .env.local   # NVIDIA_API_KEY, CHAT_MODELS 채우기
npm run dev                 # http://localhost:3000/dev-host.html 에서 위젯 확인
```

인덱스를 갱신하려면 `npm run ingest`를 실행합니다. 로컬에서 Redis 설정을 비워두면 메모리 요청 제한을 사용하며, 배포에서는 인스턴스 사이에 요청 수를 공유하도록 Redis를 설정합니다.

기본 검증은 API 키 없이 실행할 수 있습니다.

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
# .env.local을 읽지 않고 NVIDIA 키도 비워 키워드 검색만 평가 (macOS/Linux)
NVIDIA_API_KEY='' node --import tsx eval/retrieval.ts
```

### PR 검사와 커버리지

[`CI`](.github/workflows/ci.yml)는 모든 PR과 `develop` push에서 Node.js 22로 `npm ci`, 커버리지를 포함한 단위 테스트, 키워드 검색 평가, 타입 검사, 빌드를 실행합니다. 모델·Redis 비밀키를 주입하지 않으며, NVIDIA 호출은 하지 않습니다. 의존성 설치와 GitHub artifact 업로드에는 네트워크를 사용합니다. 검색 평가의 기존 목표 90%는 유지합니다.

Vitest와 `@vitest/coverage-v8`의 버전을 맞추고, `coverage/lcov.info`, `coverage/coverage-final.json`, HTML 보고서를 생성합니다. CI의 `coverage-<run_id>-<attempt>` artifact에서 7일 동안 확인할 수 있습니다. HTML/JSON에는 소스나 경로가 포함될 수 있으므로 artifact 열람 권한도 고려하세요. DebtDraft 등 외부 분석 서비스에는 업로드하지 않습니다.

커버리지 범위는 `lib/`, `ingest/`, `app/`의 TS/TSX, `public/widget.js`, `eval/`의 TS입니다. 테스트가 import하지 않은 API 진입점, UI, 수집·평가 실행 파일도 0%로 표시되도록 명시했습니다. 타입 선언 파일은 제외합니다. 아직 DOM/E2E 테스트가 없으므로 UI의 0%를 숨기지 않으며, 전체 수치를 올리려고 범위를 줄이거나 임의의 최소 커버리지 기준을 적용하지 않았습니다.

### 별도 실행하는 모델 평가

`npm run eval:retrieval`은 `.env.local`을 읽습니다. `NVIDIA_API_KEY`가 있으면 질문을 NVIDIA로 전송해 임베딩하고, 없으면 키워드만 평가합니다. `npm run eval:answers -- <model> [model...]`은 키가 필수이며, 질문 임베딩과 모델별 답변 생성에 실제 외부 API를 사용합니다. 질문과 검색된 블로그 근거가 제공자에게 전송되고 할당량·비용이 발생할 수 있어 기본 PR CI에 넣지 않았습니다. 비용과 제공자 사용 조건을 확인한 뒤 개발자가 별도로 실행하세요. 기존 자동 수집 workflow의 임베딩 검색 평가는 그대로 유지합니다.

### DebtDraft 연동 준비 (기본 비활성)

[`docs/workflows/debtdraft.yml.example`](docs/workflows/debtdraft.yml.example)은 실행되지 않는 템플릿입니다. 현재 CI는 DebtDraft를 호출하지 않습니다. 계정 생성, 저장소 연결/OAuth·App 설치, 키 발급·등록 및 분석 전송은 이 변경에 포함되지 않습니다.

공식 [`README`](https://github.com/debtdraft/debtdraft-action/blob/03d163dc0e4637c2e06c1f2c18e3f7a9ceb13909/README.md), [`action.yml`](https://github.com/debtdraft/debtdraft-action/blob/03d163dc0e4637c2e06c1f2c18e3f7a9ceb13909/action.yml), [`LICENSE`](https://github.com/debtdraft/debtdraft-action/blob/03d163dc0e4637c2e06c1f2c18e3f7a9ceb13909/LICENSE)를 확인한 `v1.0.5` 커밋으로 고정했습니다. GitHub 제공 액션도 커밋 SHA로 고정했습니다. 갱신 시 새 릴리스의 동작·권한·약관을 다시 검토하세요.

- DebtDraft는 테스트를 실행하지 않습니다. 템플릿은 같은 job에서 먼저 테스트하고 생성한 `coverage/lcov.info`를 `coverage-files` 입력으로 전달합니다. 보고서가 없으면 커버리지가 n/a로 빠지므로 테스트·보고서 생성 실패를 무시하지 않습니다.
- 복잡도, 커버리지, 중복, 오래된 의존성, 취약 의존성을 평가합니다. 공식 설명상 소스·코드 조각·환경변수·GitHub 토큰·비밀 값은 DebtDraft에 업로드하지 않습니다. 다만 파일 경로, 함수명, 행·범위, 패키지명·버전, 취약점 정보, 점수, 저장소 ID·커밋 SHA·PR 번호는 전송합니다. 이는 공식 문서의 설명이며 전송이 없는 로컬 전용 도구라는 의미는 아닙니다.
- API 키를 bearer token으로 사용해 분석 전 저장소 연결 상태를 확인합니다. 분석 결과 업로드는 PR 및 기본 브랜치 push에서 발생합니다. 패키지명·버전은 레지스트리 정보 및 취약점 조회 서비스에도 전송합니다. 공식 설명상 사설 레지스트리 scope는 조회에서 제외합니다. 템플릿은 기본 HTTPS API 주소를 유지합니다.
- 키가 없거나 유효하지 않거나 저장소 연결·플랜 제한에 걸리면 실패합니다. 서비스 일시 장애, 업로드 제한(429), PR 댓글 권한 오류는 경고만 남길 수 있으므로 초록색 job만으로 대시보드 저장을 보장할 수 없습니다.
- 비밀 탐지는 별도 결과이며, 기본값은 PR 변경 행에 새 고신뢰 비밀이 있을 때 실패합니다. 전체 git 이력이나 활성 여부를 검사하지 않으며 일부 파일은 제외됩니다. 보안 검토나 별도 비밀 탐지를 대신하지 않습니다.
- 라이선스는 **All rights reserved**입니다. DebtDraft 계정과 함께 자신의 저장소 Actions에서 사용할 수 있으나 수정·재배포·파생 서비스 등에 제한이 있습니다. 액션 자체 비용과 서비스 플랜은 별개이며 [서비스 약관](https://debtdraft.dev/terms)과 [개인정보 정책](https://debtdraft.dev/privacy)도 확인해야 합니다. 이 저장소에는 액션 구현을 복사하지 않았습니다.

활성화하려면 사용자가 다음 순서로 진행해야 합니다.

1. 위 분석 정보의 외부 전송, 라이선스와 서비스 조건, 사용할 플랜을 검토하고 **활성화를 별도로 승인**합니다.
2. 승인 후 DebtDraft 계정에서 이 저장소를 연결합니다. OAuth/App 권한 요청이 나오면 요청 권한을 검토하고 승인합니다.
3. DebtDraft Settings → API keys에서 키를 발급하고 GitHub 저장소 Settings → Secrets and variables → Actions에 `DEBTDRAFT_API_KEY`로 등록합니다. 키를 파일이나 PR에 넣지 않습니다.
4. 템플릿을 `.github/workflows/debtdraft.yml`로 복사하는 별도 PR을 검토합니다. 기본 브랜치가 `develop`인지 다시 확인합니다. 템플릿은 `contents: read`, 해당 job에만 댓글용 `pull-requests: write`를 부여하고 checkout 인증을 남기지 않습니다.
5. 템플릿은 fork PR과 Dependabot을 키 접근 job 전체에서 제외합니다. `pull_request_target`으로 바꾸지 마세요. 같은 저장소 PR의 테스트·의존성 코드도 runner에서 실행되므로 신뢰한 기여자/변경에만 허용하고, 필요하면 키를 필수 승인자가 있는 GitHub Environment로 옮기고 job에 해당 `environment`를 지정하세요. SHA 고정과 fork 차단만으로 악성 의존성이나 같은 저장소의 악성 PR까지 막지는 못합니다.
6. 활성화 PR이 승인된 뒤 신뢰한 PR/기본 브랜치에서 첫 실행의 로그, 댓글, 대시보드를 확인합니다. 검증 전 DebtDraft를 필수 병합 검사로 지정하지 마세요. 중지하려면 workflow를 비활성화하고 키를 폐기합니다.

GitHub Actions의 결제·사용 한도로 runner가 시작되지 않으면 코드 검사 결과가 아닙니다. 실행 페이지의 시작 오류를 확인하고, 로컬 검증 결과와 CI 실행 결과를 구분하세요.

이 준비 작업의 `codex/pr-ci-coverage-debtdraft` 브랜치는 [`vercel.json`](vercel.json)의 [브랜치별 설정](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)으로 Vercel 자동 배포에서 제외합니다. Draft PR 검토 중 Preview가 생성되지 않게 하기 위한 설정입니다.

## 배포

Vercel에 저장소를 연결하고 프로덕션 브랜치를 `develop`으로 설정합니다.

### Vercel 환경변수

Production에 아래 변수를 설정합니다. 도메인 값은 자신의 배포 주소와 블로그 주소로 바꿉니다. API 키는 [NVIDIA API 카탈로그](https://build.nvidia.com)에서, Redis REST URL과 토큰은 Upstash에서 발급합니다. 키와 토큰은 서버 환경변수로 관리하고 저장소에 커밋하지 않습니다.

| 변수 | 타입 | 값 또는 용도 |
| --- | --- | --- |
| `NVIDIA_API_KEY` | Secret | NVIDIA API 키 |
| `CHAT_MODELS` | Config | `nvidia/nemotron-3-super-120b-a12b,openai/gpt-oss-20b` |
| `APP_ORIGIN` | Config | `https://blog-agent-ruddy.vercel.app` (끝에 `/` 없이) |
| `FRAME_ANCESTORS` | Config | `https://hyunolike.tistory.com` |
| `UPSTASH_REDIS_REST_URL` | Secret | Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Secret | Redis REST 토큰 |

`EMBEDDING_MODEL`은 선택 사항입니다. 수집의 기본값은 `nvidia/nemotron-3-embed-1b`이며, 채팅은 인덱스에 기록된 모델로 질문을 임베딩합니다.

연결된 프로젝트에서 프로덕션을 배포하는 명령은 다음과 같습니다.

```bash
vercel deploy --prod --yes
```

환경변수를 바꾸면 재배포해야 합니다. Preview에서 채팅을 시험하려면 해당 환경에도 변수를 설정합니다.

### GitHub 자동 수집

Settings → Secrets and variables → Actions에 Secret `NVIDIA_API_KEY`를 등록합니다. Variable `EMBEDDING_MODEL`은 선택 사항입니다.

`ingest`는 매일 예약 실행되며 Actions 탭에서 수동으로도 실행할 수 있습니다. 변경된 내용이 있으면 `data/index.json`을 커밋하고, Vercel Git 연동으로 배포에 반영합니다.

### 티스토리 연결

스킨 편집 → HTML에서 `</body>` 바로 위에 아래 스크립트를 넣습니다. 다른 프로젝트로 배포했다면 스크립트 주소도 바꿉니다.

```html
<script src="https://blog-agent-ruddy.vercel.app/widget.js" defer></script>
```

PC 스킨의 위젯을 모바일에서도 쓰려면 관리 → 꾸미기 → 모바일에서 “모바일 웹 자동 연결”을 끄고 실제 기기에서 확인합니다.

### 모델 API 사용 범위

NVIDIA Developer Program의 무료 API는 개발과 평가 용도입니다. 일반 방문자 대상 정식 운영에는 운영을 허용하는 계약과 제공 환경을 갖추거나 다른 모델 제공자로 전환해야 합니다. 자세한 내용은 [NVIDIA 공식 FAQ](https://docs.api.nvidia.com/nim/docs/product)를 참고합니다.

<br>

## 만든 사람 👤

| <img src="https://github.com/hyunolike.png" width="120" alt="hyunolike"> |
| :---: |
| [hyunolike](https://github.com/hyunolike) |
| [기술 블로그](https://hyunolike.tistory.com) |
