pragma circom 2.1.9;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/smt/smtverifier.circom";

// PPOI (Build §3.4): blinded non-membership of an entry origin against a
// screening provider's sparse Merkle root. The entry stores
// originHash = Poseidon(origin, blind); the proof shows that origin is absent
// from the provider's list without the verifier learning more than originHash.
// Provider lists key each flagged address by Poseidon(address).
template PPOI(nLevels) {
    signal input providerRoot;
    signal input originHash;

    signal input origin;
    signal input blind;
    signal input siblings[nLevels];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;

    component oh = Poseidon(2);
    oh.inputs[0] <== origin;
    oh.inputs[1] <== blind;
    oh.out === originHash;

    component key = Poseidon(1);
    key.inputs[0] <== origin;

    // SMTVerifier does not constrain isOld0 to a bit; a field value here lets a
    // flagged origin forge non-membership (audit Critical, 2026-10-22).
    isOld0 * (isOld0 - 1) === 0;

    component smt = SMTVerifier(nLevels);
    smt.enabled <== 1;
    smt.fnc <== 1; // 1 = prove non-inclusion
    smt.root <== providerRoot;
    for (var i = 0; i < nLevels; i++) smt.siblings[i] <== siblings[i];
    smt.oldKey <== oldKey;
    smt.oldValue <== oldValue;
    smt.isOld0 <== isOld0;
    smt.key <== key.out;
    smt.value <== 0;
}

component main {public [providerRoot, originHash]} = PPOI(32);
