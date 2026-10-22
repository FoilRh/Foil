pragma circom 2.1.9;

// Foil note primitives (Build §2, §3.1). All hashes are circomlib Poseidon over BN254.
//   mpk = Poseidon(pk_auth.x, pk_auth.y, Poseidon(nk))
//   npk = Poseidon(mpk, rho)
//   C   = Poseidon(token, amount, npk)
//   N   = Poseidon(nk, rho, poolId)

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/switcher.circom";
include "../../node_modules/circomlib/circuits/eddsaposeidon.circom";

// Amounts are USDG base units; 120 bits is far above any real balance and
// keeps sums of a few amounts well inside the field.
template AmountCheck() {
    signal input amount;
    component bits = Num2Bits(120);
    bits.in <== amount;
}

template MasterPublicKey() {
    signal input Ax;
    signal input Ay;
    signal input nk;
    signal output mpk;
    component hnk = Poseidon(1);
    hnk.inputs[0] <== nk;
    component h = Poseidon(3);
    h.inputs[0] <== Ax;
    h.inputs[1] <== Ay;
    h.inputs[2] <== hnk.out;
    mpk <== h.out;
}

template NoteCommitment() {
    signal input token;
    signal input amount;
    signal input mpk;
    signal input rho;
    signal output npk;
    signal output commitment;
    component hn = Poseidon(2);
    hn.inputs[0] <== mpk;
    hn.inputs[1] <== rho;
    npk <== hn.out;
    component hc = Poseidon(3);
    hc.inputs[0] <== token;
    hc.inputs[1] <== amount;
    hc.inputs[2] <== npk;
    commitment <== hc.out;
}

// Commitment to an arbitrary npk (an output note for someone else).
template CommitToNpk() {
    signal input token;
    signal input amount;
    signal input npk;
    signal output commitment;
    component hc = Poseidon(3);
    hc.inputs[0] <== token;
    hc.inputs[1] <== amount;
    hc.inputs[2] <== npk;
    commitment <== hc.out;
}

template Nullifier() {
    signal input nk;
    signal input rho;
    signal input poolId;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== nk;
    h.inputs[1] <== rho;
    h.inputs[2] <== poolId;
    out <== h.out;
}

// Poseidon(2) binary Merkle tree; pathIndices bit i = 1 means the node is a right child.
template MerkleRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices;
    signal output root;

    component bits = Num2Bits(levels);
    bits.in <== pathIndices;
    component sw[levels];
    component h[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        sw[i] = Switcher();
        sw[i].sel <== bits.out[i];
        sw[i].L <== cur[i];
        sw[i].R <== pathElements[i];
        h[i] = Poseidon(2);
        h[i].inputs[0] <== sw[i].outL;
        h[i].inputs[1] <== sw[i].outR;
        cur[i + 1] <== h[i].out;
    }
    root <== cur[levels];
}

// One spent note: proves ownership via the derived mpk, membership (skipped for
// zero-amount dummies) and the correct nullifier.
template SpendInput(levels) {
    signal input token;
    signal input poolId;
    signal input root;
    signal input mpk;
    signal input nk;
    signal input amount;
    signal input rho;
    signal input pathElements[levels];
    signal input pathIndices;
    signal input nullifier;

    component amt = AmountCheck();
    amt.amount <== amount;

    component note = NoteCommitment();
    note.token <== token;
    note.amount <== amount;
    note.mpk <== mpk;
    note.rho <== rho;

    component nul = Nullifier();
    nul.nk <== nk;
    nul.rho <== rho;
    nul.poolId <== poolId;
    nul.out === nullifier;

    component tree = MerkleRoot(levels);
    tree.leaf <== note.commitment;
    for (var i = 0; i < levels; i++) tree.pathElements[i] <== pathElements[i];
    tree.pathIndices <== pathIndices;

    component isZero = IsZero();
    isZero.in <== amount;
    component eq = ForceEqualIfEnabled();
    eq.enabled <== 1 - isZero.out;
    eq.in[0] <== root;
    eq.in[1] <== tree.root;
}

// EdDSA (Baby Jubjub, Poseidon) signature by sk_auth over msg. Build §3.1 key split:
// no valid proof exists without this signature.
template SpendAuth() {
    signal input Ax;
    signal input Ay;
    signal input S;
    signal input R8x;
    signal input R8y;
    signal input msg;
    component v = EdDSAPoseidonVerifier();
    v.enabled <== 1;
    v.Ax <== Ax;
    v.Ay <== Ay;
    v.S <== S;
    v.R8x <== R8x;
    v.R8y <== R8y;
    v.M <== msg;
}
