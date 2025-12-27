// State common between the frontend and backend
type CommonState = {
    state: "introduction" | "waiting_for_partner" | "chatting";
    partner?: string;
};
