// State common between the frontend and backend
type State = {
    state: "introduction" | "waiting_for_partner" | "chatting";
    partner?: string;
};
