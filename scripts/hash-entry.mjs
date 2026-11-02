// The app needs incremental hashing for optional disk verification and recovery.
// @noble/hashes is bundled locally; no file data is sent to a hashing service.
import { sha256 } from '@noble/hashes/sha2';
window.VanillaWarpCreateSHA256 = () => sha256.create();
