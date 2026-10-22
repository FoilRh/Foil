pragma circom 2.1.9;

include "./lib.circom";

// 2-in / 2-out join-split (Build §3.4): membership, nullifiers, EdDSA spend auth,
// conservation and extDataHash binding.
//
// publicAmount is the signed external flow as a field element, set by the contract:
//   withdraw w with relayer fee f  →  publicAmount = p - (w + f)
//   internal transfer with fee f   →  publicAmount = p - f
// so sum(in) + publicAmount == sum(out) (mod p).
template JoinSplit(levels) {
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input token;
    signal input poolId;
    signal input inNullifier[2];
    signal input outCommitment[2];

    signal input Ax;
    signal input Ay;
    signal input nk;
    signal input sigS;
    signal input sigR8x;
    signal input sigR8y;
    signal input inAmount[2];
    signal input inRho[2];
    signal input inPathElements[2][levels];
    signal input inPathIndices[2];
    signal input outAmount[2];
    signal input outNpk[2];

    component key = MasterPublicKey();
    key.Ax <== Ax;
    key.Ay <== Ay;
    key.nk <== nk;

    component ins[2];
    for (var i = 0; i < 2; i++) {
        ins[i] = SpendInput(levels);
        ins[i].token <== token;
        ins[i].poolId <== poolId;
        ins[i].root <== root;
        ins[i].mpk <== key.mpk;
        ins[i].nk <== nk;
        ins[i].amount <== inAmount[i];
        ins[i].rho <== inRho[i];
        for (var j = 0; j < levels; j++) ins[i].pathElements[j] <== inPathElements[i][j];
        ins[i].pathIndices <== inPathIndices[i];
        ins[i].nullifier <== inNullifier[i];
    }

    component sameNullifier = IsEqual();
    sameNullifier.in[0] <== inNullifier[0];
    sameNullifier.in[1] <== inNullifier[1];
    sameNullifier.out === 0;

    component outs[2];
    component outAmt[2];
    for (var i = 0; i < 2; i++) {
        outAmt[i] = AmountCheck();
        outAmt[i].amount <== outAmount[i];
        outs[i] = CommitToNpk();
        outs[i].token <== token;
        outs[i].amount <== outAmount[i];
        outs[i].npk <== outNpk[i];
        outs[i].commitment === outCommitment[i];
    }

    inAmount[0] + inAmount[1] + publicAmount === outAmount[0] + outAmount[1];

    component msg = Poseidon(7);
    msg.inputs[0] <== root;
    msg.inputs[1] <== publicAmount;
    msg.inputs[2] <== extDataHash;
    msg.inputs[3] <== inNullifier[0];
    msg.inputs[4] <== inNullifier[1];
    msg.inputs[5] <== outCommitment[0];
    msg.inputs[6] <== outCommitment[1];

    component auth = SpendAuth();
    auth.Ax <== Ax;
    auth.Ay <== Ay;
    auth.S <== sigS;
    auth.R8x <== sigR8x;
    auth.R8y <== sigR8y;
    auth.msg <== msg.out;
}

component main {public [root, publicAmount, extDataHash, token, poolId, inNullifier, outCommitment]} = JoinSplit(32);
