# Sharing between machines

Two machines each running STL Manager can see what the other holds and copy
models across. Neither is in charge, and neither can change the other.

## What you need

Both machines running the server, and each able to reach the other's address.

## Pairing

Each server prints two tokens when it starts:

```
Access token:  7f3a9c2e...
Share token:   b41d8a06...   (read-only, give this to a paired machine)
```

They are not interchangeable, and the difference matters:

- The **access token** is that machine's full authority. Anything holding it can
  scan, sort and undo. It never leaves the machine it belongs to.
- The **share token** grants reading, and nothing else. There is no route it can
  reach that moves, deletes or sorts anything. This is the one you give out.

On the machine that wants to browse, open **Machines**, and enter the other
machine's address, its **share token**, and the path to its library. Pairing
checks it immediately, so a wrong token fails there and then rather than later.

## Pulling

Browse a paired machine and choose Pull. The files arrive in a staging folder
called `_Incoming`, beside your library. Nothing else happens automatically.

Then scan that folder as you would any other. The models are grouped,
deduplicated and filed by **your** rules, not the layout the other machine used,
and the move into your library is journalled like any other run, so it can be
undone.

The other machine keeps its copies. Pulling copies; it never moves.

## What cannot happen

- A paired machine cannot write anything on yours. There is no push.
- A share token cannot reach anything except the catalogue and file reads.
- A peer cannot serve you a file from outside its own library, and cannot make
  you write outside your staging folder: filenames from a peer are reduced to a
  bare name before they are used.

## Known limitation

Pulling the same model twice, and sorting both times, leaves two copies in your
library rather than recognising the second as a duplicate. The scanner never
looks inside the library, so it cannot compare against what is already filed.
Nothing is lost, and the second copy is named distinctly, but you have to delete
it yourself.
