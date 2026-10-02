# blog-agent

[hyunolike 기술 블로그](https://hyunolike.tistory.com)의 글을 근거로 답하는 AI 채팅입니다. 티스토리 스킨에 스크립트 한 줄을 넣으면 오른쪽 아래에 채팅 버튼이 생깁니다.

설계: [`docs/superpowers/specs/2026-09-29-blog-chat-agent-design.md`](docs/superpowers/specs/2026-09-29-blog-chat-agent-design.md)

## 구조

- `ingest/`: 매일 sitemap을 읽어 바뀐 글만 크롤링하고, 조각으로 나눠 임베딩해 `data/index.json`을 만듭니다.
- `lib/`: 하이브리드 검색(벡터 + BM25), 프롬프트, 무료 → 유료 모델 전환, 요청 제한.
- `app/`: `/embed` 채팅 화면과 `/api/chat` 스트리밍 API (Next.js, Vercel).
- `public/widget.js`: 티스토리 스킨이 불러가는 위젯.
- `eval/`: 검색 recall@6과 답변 품질 평가.

## 로컬 실행

```bash
npm ci
cp .env.example .env.local   # OPENROUTER_API_KEY, PAID_MODEL, FREE_MODELS 채우기
npm run ingest               # data/index.json 생성 (1~2분)
npm run dev                  # http://localhost:3000/dev-host.html 에서 위젯 확인
npm test
```

## 배포

1. **OpenRouter:** API 키를 만들고 키 설정에서 사용 한도(credit limit)를 겁니다. 무료 모델 하루 한도를 1,000회로 늘리려면 크레딧을 $10 이상 한 번 충전합니다.
2. **Upstash:** Redis 데이터베이스(무료)를 만들고 REST URL과 토큰을 복사합니다.
3. **Vercel:** 이 저장소를 import 하고 환경변수를 넣습니다.
   - `OPENROUTER_API_KEY`, `FREE_MODELS`, `PAID_MODEL`, `EMBEDDING_MODEL`
   - Vercel의 `EMBEDDING_MODEL`은 인덱스를 읽지 못했을 때만 쓰는 대비값입니다. 채팅은 `data/index.json`에 기록된 임베딩 모델로 질문을 임베딩하고, 두 값이 다르면 로그에 `embedding_model_mismatch`를 남깁니다.
   - `APP_ORIGIN` = 배포 주소(예: `https://blog-agent.vercel.app`)
   - `FRAME_ANCESTORS` = `https://hyunolike.tistory.com`
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - Settings → Git에서 Fork Protection이 켜져 있는지 확인합니다.
4. **GitHub:** Settings → Secrets and variables → Actions
   - Secret `OPENROUTER_API_KEY`
   - Variable `EMBEDDING_MODEL`
   - Settings → Code security에서 Secret scanning push protection을 켭니다.
   - Actions 탭에서 `ingest` workflow를 한 번 수동 실행합니다.
5. **티스토리:** 스킨 편집 → HTML에서 `</body>` 바로 위에 넣습니다.
   ```html
   <script src="https://blog-agent.vercel.app/widget.js" defer></script>
   ```
   관리 → 꾸미기 → 모바일에서 "모바일 웹 자동 연결"이 꺼져 있어야 모바일에서도 위젯이 보입니다.

## 배포 전 체크리스트

- [ ] Vercel 환경변수 설정
- [ ] OpenRouter 키 사용 한도 확인
- [ ] Secret scanning push protection, Vercel Fork Protection 확인
- [ ] `curl -sI https://<배포 주소>/embed | grep -i content-security-policy` → `frame-ancestors https://hyunolike.tistory.com`
- [ ] `ingest` workflow 수동 실행 → `data/index.json` 커밋 → 재배포 확인
- [ ] 티스토리 PC와 모바일에서 열기, 닫기, 출처 링크 이동 확인
- [ ] 같은 IP로 11번 연속 질문해 요청 제한 안내 문구 확인
- [ ] OpenRouter 설정 → Privacy에서 무료 모델(데이터 정책) 사용이 허용돼 있는지 확인 (꺼져 있으면 무료 호출이 전부 유료로 넘어감)
- [ ] 저장소 기본 브랜치가 Vercel 프로덕션 브랜치와 같은지 확인 (매일 수집 커밋이 기본 브랜치로 들어감)
- [ ] FRAME_ANCESTORS를 바꾸면 재배포 필요 (빌드 시점에 읽음)

## 운영

- Vercel 로그에서 `"event":"chat"` 줄의 `tier`(free/paid)와 `fallbackReason`으로 유료 전환 비율을 봅니다.
- 유료 전환이 잦으면 `npm run eval:answers`로 무료 모델 후보를 다시 평가해 `FREE_MODELS`를 바꿉니다.
- 스킨을 바꾼 뒤 `ingest`가 `본문 추출 실패`로 멈추면 `ingest/extract.ts`의 `#article-view .contents_style` 선택자를 확인합니다.
