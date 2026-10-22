#!/usr/bin/env bash
# Hand-picked mutation sample: applies one single-line mutation at a time to a TEMP COPY
# of contracts/ (never the real src/), runs `forge test`, and reports killed/survived.
#   bash test/mutation.sh            # all mutants
#   bash test/mutation.sh 3 7        # only mutants 3 and 7
# MUT_DIR overrides the scratch folder (default: $TMPDIR or /tmp, under foil-mut/).
# Lighter fuzz/invariant settings keep each run short; --fail-fast stops at the first kill.
set -uo pipefail
[ -d "$HOME/.foundry/bin" ] && export PATH="$HOME/.foundry/bin:$PATH"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
MUT="${MUT_DIR:-${TMPDIR:-/tmp}/foil-mut}"
WORK="$MUT/contracts"
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
NM="$(native "$(cd "$SRC/.." && pwd)/node_modules")"

export FOUNDRY_FUZZ_RUNS="${FOUNDRY_FUZZ_RUNS:-128}"
export FOUNDRY_INVARIANT_RUNS="${FOUNDRY_INVARIANT_RUNS:-32}"
export FOUNDRY_INVARIANT_DEPTH="${FOUNDRY_INVARIANT_DEPTH:-200}"

# file@@original code (exact, first match)@@mutated code
MUTANTS=(
  "StashPool.sol@@if (usdg.balanceOf(address(this)) < totalIn - totalOut) revert Conservation();@@if (false) revert Conservation();"
  "StashPool.sol@@if (amount < MIN_DEPOSIT || amount >= MAX_AMOUNT@@if (amount < 1 || amount >= MAX_AMOUNT"
  "StashPool.sol@@uint256 protocolFee = _bpsCeil(out, WITHDRAW_FEE_BPS);@@uint256 protocolFee = _bpsCeil(out, DEPOSIT_FEE_BPS);"
  "StashPool.sol@@ext.fee > MAX_RELAYER_FEE ||@@ext.fee > 2 * MAX_RELAYER_FEE ||"
  "StashPool.sol@@if (nullifierSpent[nullifiers[i]]) revert NullifierSpent();@@if (false) revert NullifierSpent();"
  "StashPool.sol@@nullifierSpent[nullifiers[i]] = true;@@nullifierSpent[nullifiers[i]] = false;"
  "StashPool.sol@@if (fee != (gross > freeLeft@@if (fee < (gross > freeLeft"
  "StashPool.sol@@reservedTotal -= q.reserved;@@reservedTotal -= 0;"
  "StashPool.sol@@feesAccrued += q.reserved - q.size - q.gasFee;@@feesAccrued += q.reserved - q.size;"
  "FoilStaking.sol@@if (earningShares() == 0) periodFinish += la - lastUpdate;@@if (false) periodFinish += la - lastUpdate;"
  "FoilStaking.sol@@(shares[who] - exitShares[who]) * (rewardPerShare()@@shares[who] * (rewardPerShare()"
  "FoilStaking.sol@@if (block.timestamp > at + EXIT_WINDOW) revert ExitExpired();@@if (block.timestamp > at + EXIT_WINDOW + 1 days) revert ExitExpired();"
  "FoilStaking.sol@@totalExiting -= s;@@totalExiting -= 0;"
  "Bonds.sol@@b.openSlashes -= 1;@@b.openSlashes -= 0;"
  "Bonds.sol@@if (b.openSlashes != 0) revert SlashPending();@@if (false) revert SlashPending();"
  "Bonds.sol@@block.timestamp <= s.proposedAt + VOTE_WINDOW) revert TooEarly();@@block.timestamp < s.proposedAt + VOTE_WINDOW) revert TooEarly();"
  "FeeRouter.sol@@uint256 s = total * STAKERS_BPS / 10_000;@@uint256 s = total * TREASURY_BPS / 10_000;"
  "FeeRouter.sol@@if (total < MIN_DISTRIBUTE) return 0;@@if (total < 1) return 0;"
)

echo "copying $SRC -> $WORK"
rm -rf "$WORK"
mkdir -p "$WORK/deployments" # some tests write scratch JSON there
for d in src test script lib cache out foundry.toml; do [ -e "$SRC/$d" ] && cp -r "$SRC/$d" "$WORK/"; done
# The copy is not next to node_modules: point libs at the real one.
sed -i "s#\"../node_modules\"#\"$NM\"#" "$WORK/foundry.toml"

run_tests() { (cd "$WORK" && forge test --fail-fast >"$MUT/last.log" 2>&1); }

echo "baseline..."
if ! run_tests; then echo "baseline fails in the copy; see $MUT/last.log"; exit 1; fi

pick=("$@")
killed=0; survived=0; skipped=0; survivors=()
for i in "${!MUTANTS[@]}"; do
  n=$((i + 1))
  if [ ${#pick[@]} -gt 0 ] && [[ ! " ${pick[*]} " =~ " $n " ]]; then continue; fi
  m="${MUTANTS[$i]}"; file="${m%%@@*}"; rest="${m#*@@}"; from="${rest%%@@*}"; to="${rest#*@@}"
  f="$WORK/src/$file"
  cp "$SRC/src/$file" "$f"
  if ! grep -qF -- "$from" "$f"; then
    echo "#$n $file: original not found (source changed?) -- skipped"; skipped=$((skipped + 1)); continue
  fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$f"
  if run_tests; then
    echo "#$n SURVIVED  $file: $from  ->  $to"; survived=$((survived + 1)); survivors+=("$n")
  elif grep -q "Compiler run failed" "$MUT/last.log"; then
    echo "#$n NOCOMPILE $file: $to"; skipped=$((skipped + 1))
  else
    by="$(grep -m1 -oE '\[FAIL[^]]*\] [A-Za-z_0-9]+\(' "$MUT/last.log" | sed 's/.*\] //; s/($//')"
    echo "#$n killed    $file: $to   (by ${by:-?})"; killed=$((killed + 1))
  fi
  cp "$SRC/src/$file" "$f"
done

total=$((killed + survived))
echo "mutation score: $killed/$total killed, $survived survived ${survivors[*]:-}, $skipped skipped"
[ "$survived" -eq 0 ]
