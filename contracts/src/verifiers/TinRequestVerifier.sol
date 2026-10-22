// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity 0.8.26;

contract TinRequestVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 16850420781157485788740847127969932176668410047268907933621808274331593267945;
    uint256 constant alphay  = 16896019272436326508576960916370337891960495868550628611745395002390905488246;
    uint256 constant betax1  = 21207669359294286852011553704350875347252994836581272144577977911255861267127;
    uint256 constant betax2  = 5821723095558548729212019219955885299077926737800735703700355214231476444497;
    uint256 constant betay1  = 17229800861886219117224432878752490732297107804400629410287282925132597232914;
    uint256 constant betay2  = 19930123046225376558726879222951519067624664074942923216148027199628237796829;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 16677700531637742407229187362557098037349564623984056038277822173524103181105;
    uint256 constant deltax2 = 20820287652664665591737019098183441272007746084611023275819834753393171722694;
    uint256 constant deltay1 = 17447093226957187275766060112311384127795569254550889191767428670604974548300;
    uint256 constant deltay2 = 8092247786333629650219815524254354439038228988229798525397633721585407836769;

    
    uint256 constant IC0x = 13020669002891559437393432119010117318127225891550882787403521042511611621315;
    uint256 constant IC0y = 12369849111105409076194991831481017767181003410407288728642343069338912500870;
    
    uint256 constant IC1x = 15660346955446680668485422706834509294331485748867449794235695302956863793780;
    uint256 constant IC1y = 3332137628721893754937918129418266890255906547387249740786576911509429791876;
    
    uint256 constant IC2x = 3097409501605995462417999464533664527837807668960026053859255623841742868686;
    uint256 constant IC2y = 7843941114656986636923737062866509972091939535170338125006607496039089871352;
    
    uint256 constant IC3x = 17469051504855306512663218651746276400712597148340943393072730891620098934269;
    uint256 constant IC3y = 11859818734925023475703993322949898734068388608767418411049739590479232559921;
    
    uint256 constant IC4x = 15322212694662606962711301981091974147474373676062777975357488184640555715128;
    uint256 constant IC4y = 20848025413369098419577171949642369502423914415633002203684644092676519236381;
    
    uint256 constant IC5x = 1786010479753673288406606113329491271367423818399911254967105022928632430448;
    uint256 constant IC5y = 17440827144188314836915582888241734265002787758562174642786933157252523460670;
    
    uint256 constant IC6x = 18712572940110588667748949261549061958683260063645409099465276867742785770534;
    uint256 constant IC6y = 6566154365618304804849399513242539003589977546528892120717322092059342248439;
    
    uint256 constant IC7x = 17567987779473577217529664929175806743599716400252961456581110335936754092334;
    uint256 constant IC7y = 19635861942569452636912331613039206081090126080628843058308005874276387351267;
    
    uint256 constant IC8x = 15423731919092486284495426541537312246071579349170599808022893144508105683988;
    uint256 constant IC8y = 9461492406653649561650294632678228059488808756858332353986706165972222141997;
    
    uint256 constant IC9x = 4981033797575976876198684756384322663427092993656439926314808070629163641436;
    uint256 constant IC9y = 10190509128262358504403043473834263842135629988904388092994996562689506322075;
    
    uint256 constant IC10x = 18957274017984230935933727964501575327112679382052906474686560247511107292327;
    uint256 constant IC10y = 5297290323791746797050332393893620794695306618164699617635772786524028096207;
    
    uint256 constant IC11x = 17771116644474674047265227721364667600541854027350451209989558452453261226192;
    uint256 constant IC11y = 21726391305198860427593554682859602981493010262838813069901934682799113440718;
    
    uint256 constant IC12x = 18715208924540534274150185292997737069891545827196783404348922917505082079036;
    uint256 constant IC12y = 14287762164303161315392102736826452933721424525731788886801624115516484775012;
    
    uint256 constant IC13x = 11302929236351551132745397385417472578315774518375139547581896847999626630451;
    uint256 constant IC13y = 2511084373977564929140386548554539170430662385216449354873749220330760609476;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[13] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
