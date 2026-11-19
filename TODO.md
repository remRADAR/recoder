# RC-M05-01 Evidence Checklist

- [x] Application starts successfully on the local Metro/API runtime; physical native startup is not tested.
- [x] User can create a project in the implemented workspace UI.
- [x] User can create and edit a source file in the implemented workspace UI.
- [ ] Changes survive an actual application restart; persistence is implemented and covered by storage design, but restart was not manually verified.
- [ ] File import/export works on a validated physical platform; adapters are implemented, but physical file-flow verification was not performed.
- [ ] Editor keyboard, clipboard, selection, scrolling, and accessibility are usable on a physical device; not tested.
- [x] A bounded simulated-disposable execution session can be established by an authenticated owner or explicitly gated loopback development mode.
- [x] Simulated output streams to the mobile interface through polling.
- [x] Session cancellation works and is owner-scoped.
- [x] Execution is bounded, output-limited, expiry-limited, concurrency-capped, and explicitly labeled simulated; it is not production isolation.
- [x] No credentials are exposed to client source; authenticated API requests use session credentials.
- [x] Automated checks pass, including editor bridge, HTTP security, workspace, CORS, and execution tests.
- [x] Startup/runtime smoke evidence, security limitations, known defects, and M1 recommendations are documented.

## Outstanding validation

Physical iPhone 13 and physical Android validation remain unperformed. The simulated execution proof must not be described as secure production isolation. A real isolated execution provider, device evidence, restart testing, and native import/export testing are M1 work.
