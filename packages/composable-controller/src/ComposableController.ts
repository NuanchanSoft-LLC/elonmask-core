import type { RestrictedControllerMessenger } from '@metamask/base-controller';
import { BaseControllerV1 } from '@metamask/base-controller';

/**
 * List of child controller instances
 *
 * This type encompasses controllers based up either BaseControllerV1 or
 * BaseController. The BaseController type can't be included directly
 * because the generic parameters it expects require knowing the exact state
 * shape, so instead we look for an object with the BaseController properties
 * that we use in the ComposableController (name and state).
 */
export type ControllerList = (
  | BaseControllerV1<any, any>
  | { name: string; state: Record<string, unknown> }
)[];

export type ComposableControllerRestrictedMessenger =
  RestrictedControllerMessenger<'ComposableController', never, any, never, any>;

/**
 * Controller that can be used to compose multiple controllers together.
 */
export class ComposableController extends BaseControllerV1<never, any> {
  private readonly controllers: ControllerList = [];

  private readonly messagingSystem?: ComposableControllerRestrictedMessenger;

  /**
   * Name of this controller used during composition
   */
  override name = 'ComposableController';

  /**
   * Creates a ComposableController instance.
   *
   * @param controllers - Map of names to controller instances.
   * @param messenger - The controller messaging system, used for communicating with BaseController controllers.
   */
  constructor(
    controllers: ControllerList,
    messenger?: ComposableControllerRestrictedMessenger,
  ) {
    super(
      undefined,
      controllers.reduce((state, controller) => {
        state[controller.name] = controller.state;
        return state;
      }, {} as any),
    );
    this.initialize();
    this.controllers = controllers;
    this.messagingSystem = messenger;
    this.controllers.forEach((controller) => {
      const { name } = controller;
      if ((controller as BaseControllerV1<any, any>).subscribe !== undefined) {
        (controller as BaseControllerV1<any, any>).subscribe((state) => {
          this.update({ [name]: state });
        });
      } else if (this.messagingSystem) {
        (this.messagingSystem.subscribe as any)(
          `${name}:stateChange`,
          (state: any) => {
            this.update({ [name]: state });
          },
        );
      } else {
        throw new Error(
          `Messaging system required if any BaseController controllers are used`,
        );
      }
    });
  }

  /**
   * Flat state representation, one that isn't keyed
   * of controller name. Instead, all child controller state is merged
   * together into a single, flat object.
   *
   * @returns Merged state representation of all child controllers.
   */
  get flatState() {
    let flatState = {};
    for (const controller of this.controllers) {
      flatState = { ...flatState, ...controller.state };
    }
    return flatState;
  }
}

export default ComposableController;
