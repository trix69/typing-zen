#!/bin/zsh
# Runs every Typing Zen test suite against one site and prints a pass/fail count per suite.
#   tests/run.sh            the local server (http://127.0.0.1:8801/, serving this folder)
#   tests/run.sh test       the test site (https://trix69.github.io/typing-zen-test/)
#   tests/run.sh live       the live site (https://trix69.github.io/typing-zen/)
#   tests/run.sh local words mastery   only the named suites
# Exits 1 if any check fails. Screenshots the suites take go to a throwaway folder, never into the repo.
# Needs Playwright in ~/tools/playwright (NODE_PATH below).
set -u
here=${0:A:h}
where=${1:-local}; shift 2>/dev/null
case $where in
  local) B=http://127.0.0.1:8801/;                      K=typingZen.v2;      COL=typingZen.users;      LEN=10,20;   RUN=3 ;;
  test)  B=https://trix69.github.io/typing-zen-test/;   K=typingZen.v2-test; COL=typingZen.users-test; LEN=5,10,20; RUN=2 ;;
  live)  B=https://trix69.github.io/typing-zen/;        K=typingZen.v2;      COL=typingZen.users;      LEN=10,20;   RUN=3 ;;
  *) echo "usage: tests/run.sh [local|test|live] [suite ...]"; exit 2 ;;
esac
VER=$(curl -s "${B}version.json?x=$RANDOM" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
export NODE_PATH=${NODE_PATH:-$HOME/tools/playwright/node_modules}
# Every suite and the extra argument it needs, if any.
typeset -A extra=(offline "$VER" lengths "$LEN" m2 "$RUN" google "$COL" multi "$COL" reset "$COL" homeapp "$COL" board "$COL" langs "$COL")
all=(offline lengths m2 fill google multi remove homeapp reset board update practice practice2 pcard gap triumph words mastery
     garden capital bksp center theme welcomeset dk zh langs r39fix motion interrupted dupvoice keylog2 noplay fold caseless)
# mastery.js expects the live rule (3 in a row); the test build masters after 2, which m2.js covers there.
[[ $where == test ]] && all=(${all:#mastery})
suites=(${@:-$all})
out=$(mktemp -d)
cd $out
failed=0
echo "Typing Zen tests on $where ($B, version $VER)"
for t in $suites; do
  r=$(node "$here/$t.js" "$B" "$K" ${extra[$t]:-} 2>&1)
  p=$(print -r -- "$r" | grep -c '^PASS'); f=$(print -r -- "$r" | grep -c '^FAIL')
  e=$(print -r -- "$r" | grep -c 'Error')
  # A suite that throws stops early; say so on its row, so "0 fail" never hides it.
  printf '%-12s %3d pass %3d fail%s\n' "$t" "$p" "$f" "$( (( e > 0 )) && print ' (stopped early: error)')"
  if (( f > 0 || p == 0 || e > 0 )); then failed=1; print -r -- "$r" | grep '^FAIL\|Error' | head -5 | sed 's/^/    /'; fi
done
rm -rf $out
exit $failed
