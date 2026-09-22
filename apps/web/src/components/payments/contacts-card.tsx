import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function ContactsCard({
  wallet,
  busy,
  contacts,
  name,
  setName,
  contactAddress,
  setContactAddress,
  run,
  saveContact,
  removeContact,
}: Pick<
  PaymentWorkspace,
  | "wallet"
  | "busy"
  | "contacts"
  | "name"
  | "setName"
  | "contactAddress"
  | "setContactAddress"
  | "run"
  | "saveContact"
  | "removeContact"
>) {
  return (
    <section className="card" id="contacts">
      <div className="section-title">
        <h2>Your contacts</h2>
        <span className="small">Personal aliases · verify every address</span>
      </div>
      <form
        className="contact-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(saveContact);
        }}
      >
        <input
          aria-label="Contact name"
          placeholder="Name, e.g. Ada"
          maxLength={40}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="Contact wallet address"
          placeholder="0x wallet address"
          required
          value={contactAddress}
          onChange={(e) => setContactAddress(e.target.value)}
        />
        <button disabled={!wallet || busy}>Save contact</button>
      </form>
      <div className="contact-list">
        {contacts.map((c) => (
          <div key={c.name}>
            <strong>{c.name}</strong>
            <code>{c.address}</code>
            <button disabled={busy} onClick={() => void run(() => removeContact(c.name))}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
