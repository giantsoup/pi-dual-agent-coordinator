import type { ReactElement } from "react";

import type { UiModalState } from "../../../../src/types/ui.js";
import { Drawer } from "../components/ui.js";

export function ModalDrawer(props: {
  canMutate: boolean;
  modal: UiModalState;
  onClose(): void;
}): ReactElement | null {
  if (props.modal.kind === "none") {
    return null;
  }

  return (
    <Drawer
      open={true}
      title={props.modal.title}
      onOpenChange={(open) => {
        if (!open && props.canMutate) {
          props.onClose();
        }
      }}
    >
      <pre className="modal-content" data-format={props.modal.format}>
        {props.modal.content}
      </pre>
    </Drawer>
  );
}
