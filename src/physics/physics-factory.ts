import { IPhysics } from './physics-interface';
import { RapierPhysics } from './rapier-physics';

export type PhysicsType = 'rapier';

export function createPhysics(type: PhysicsType): IPhysics {
    switch (type) {
        case 'rapier':
            return new RapierPhysics();
        default:
            throw new Error(`Unknown physics type: ${type}`);
    }
}
